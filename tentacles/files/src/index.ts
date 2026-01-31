/**
 * Files Tentacle
 * The storage arm of the Octpus - file management and cloud sync
 *
 * Capabilities:
 * - Local file operations (read, write, copy, move, delete)
 * - Directory management
 * - File watching and monitoring
 * - Cloud storage sync (Google Drive, Dropbox, S3)
 * - File search and indexing
 * - Archive operations (zip, tar)
 *
 * Security:
 * - Path validation and sandboxing
 * - Permission-based access control
 * - Encrypted file handling
 */

import { EventEmitter } from 'eventemitter3';
import { nanoid } from 'nanoid';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import {
  TentacleRegistration,
  TentacleCapability,
  PermissionLevel,
} from '@octpus/types';

// =============================================================================
// TYPES
// =============================================================================

export interface FilesConfig {
  workingDir?: string;
  sandboxed?: boolean;
  maxFileSize?: number;
  allowedExtensions?: string[];
  blockedPaths?: string[];
  cloudProviders?: CloudProviderConfig[];
}

export interface CloudProviderConfig {
  provider: 'gdrive' | 'dropbox' | 's3' | 'local';
  credentials?: Record<string, string>;
  basePath?: string;
}

export interface FileInfo {
  name: string;
  path: string;
  size: number;
  isDirectory: boolean;
  isFile: boolean;
  created: Date;
  modified: Date;
  accessed: Date;
  permissions: string;
  extension?: string;
  mimeType?: string;
}

export interface FileOperation {
  id: string;
  type: 'read' | 'write' | 'copy' | 'move' | 'delete' | 'upload' | 'download';
  source: string;
  destination?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  progress?: number;
  error?: string;
  timestamp: Date;
}

export interface WatchEvent {
  type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';
  path: string;
  timestamp: Date;
}

// =============================================================================
// FILES TENTACLE
// =============================================================================

export class FilesTentacle {
  readonly registration: TentacleRegistration;
  readonly events: EventEmitter;

  private config: FilesConfig;
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private operations: Map<string, FileOperation> = new Map();
  private fileIndex: Map<string, FileInfo> = new Map();

  constructor(config: FilesConfig = {}) {
    this.config = {
      workingDir: os.homedir(),
      sandboxed: true,
      maxFileSize: 100 * 1024 * 1024, // 100MB
      blockedPaths: ['/etc', '/var', '/usr', '/bin', '/sbin', '/root', '/.ssh'],
      ...config,
    };

    this.events = new EventEmitter();

    this.registration = {
      id: 'files',
      type: 'files',
      name: 'Files Tentacle',
      description: 'File management, cloud storage sync, and file operations',
      version: '0.1.0',
      capabilities: this.buildCapabilities(),
      status: 'initializing',
      sandboxed: this.config.sandboxed,
      resourceLimits: {
        maxMemoryMB: 256,
        maxCPUPercent: 25,
        maxNetworkMBps: 50,
        maxExecutionSeconds: 600,
      },
    };
  }

  async initialize(): Promise<void> {
    console.log('🐙 Files Tentacle initializing...');

    if (!fs.existsSync(this.config.workingDir!)) {
      fs.mkdirSync(this.config.workingDir!, { recursive: true });
    }

    this.registration.status = 'ready';
    console.log('🐙 Files Tentacle ready!');
  }

  // ===========================================================================
  // FILE OPERATIONS
  // ===========================================================================

  async read(filePath: string): Promise<string> {
    const fullPath = this.resolvePath(filePath);
    this.validatePath(fullPath);

    const stats = fs.statSync(fullPath);
    if (stats.size > this.config.maxFileSize!) {
      throw new Error(`File too large: ${stats.size} bytes (max: ${this.config.maxFileSize})`);
    }

    return fs.readFileSync(fullPath, 'utf-8');
  }

  async readBinary(filePath: string): Promise<Buffer> {
    const fullPath = this.resolvePath(filePath);
    this.validatePath(fullPath);

    return fs.readFileSync(fullPath);
  }

  async write(filePath: string, content: string | Buffer): Promise<FileInfo> {
    const fullPath = this.resolvePath(filePath);
    this.validatePath(fullPath);

    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, content);
    this.events.emit('file:written', { path: fullPath });

    return this.getInfo(filePath);
  }

  async append(filePath: string, content: string): Promise<void> {
    const fullPath = this.resolvePath(filePath);
    this.validatePath(fullPath);

    fs.appendFileSync(fullPath, content);
    this.events.emit('file:appended', { path: fullPath });
  }

  async copy(source: string, destination: string): Promise<FileInfo> {
    const srcPath = this.resolvePath(source);
    const destPath = this.resolvePath(destination);
    this.validatePath(srcPath);
    this.validatePath(destPath);

    const opId = nanoid();
    this.trackOperation(opId, 'copy', srcPath, destPath);

    try {
      const stats = fs.statSync(srcPath);
      if (stats.isDirectory()) {
        await this.copyDir(srcPath, destPath);
      } else {
        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }
        fs.copyFileSync(srcPath, destPath);
      }

      this.completeOperation(opId);
      this.events.emit('file:copied', { source: srcPath, destination: destPath });
      return this.getInfo(destination);
    } catch (error: any) {
      this.failOperation(opId, error.message);
      throw error;
    }
  }

  async move(source: string, destination: string): Promise<FileInfo> {
    const srcPath = this.resolvePath(source);
    const destPath = this.resolvePath(destination);
    this.validatePath(srcPath);
    this.validatePath(destPath);

    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    fs.renameSync(srcPath, destPath);
    this.events.emit('file:moved', { source: srcPath, destination: destPath });

    return this.getInfo(destination);
  }

  async delete(filePath: string, recursive: boolean = false): Promise<void> {
    const fullPath = this.resolvePath(filePath);
    this.validatePath(fullPath);

    const stats = fs.statSync(fullPath);
    if (stats.isDirectory()) {
      if (recursive) {
        fs.rmSync(fullPath, { recursive: true });
      } else {
        fs.rmdirSync(fullPath);
      }
    } else {
      fs.unlinkSync(fullPath);
    }

    this.events.emit('file:deleted', { path: fullPath });
  }

  async exists(filePath: string): Promise<boolean> {
    const fullPath = this.resolvePath(filePath);
    return fs.existsSync(fullPath);
  }

  async getInfo(filePath: string): Promise<FileInfo> {
    const fullPath = this.resolvePath(filePath);
    this.validatePath(fullPath);

    const stats = fs.statSync(fullPath);
    const ext = path.extname(fullPath);

    return {
      name: path.basename(fullPath),
      path: fullPath,
      size: stats.size,
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
      created: stats.birthtime,
      modified: stats.mtime,
      accessed: stats.atime,
      permissions: (stats.mode & 0o777).toString(8),
      extension: ext || undefined,
      mimeType: this.getMimeType(ext),
    };
  }

  // ===========================================================================
  // DIRECTORY OPERATIONS
  // ===========================================================================

  async mkdir(dirPath: string, recursive: boolean = true): Promise<void> {
    const fullPath = this.resolvePath(dirPath);
    this.validatePath(fullPath);

    fs.mkdirSync(fullPath, { recursive });
    this.events.emit('dir:created', { path: fullPath });
  }

  async list(dirPath: string = '.'): Promise<FileInfo[]> {
    const fullPath = this.resolvePath(dirPath);
    this.validatePath(fullPath);

    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    const files: FileInfo[] = [];

    for (const entry of entries) {
      const entryPath = path.join(fullPath, entry.name);
      try {
        const stats = fs.statSync(entryPath);
        const ext = path.extname(entry.name);

        files.push({
          name: entry.name,
          path: entryPath,
          size: stats.size,
          isDirectory: entry.isDirectory(),
          isFile: entry.isFile(),
          created: stats.birthtime,
          modified: stats.mtime,
          accessed: stats.atime,
          permissions: (stats.mode & 0o777).toString(8),
          extension: ext || undefined,
          mimeType: this.getMimeType(ext),
        });
      } catch {
        // Skip files we can't access
      }
    }

    return files;
  }

  async tree(dirPath: string = '.', depth: number = 3): Promise<any> {
    const fullPath = this.resolvePath(dirPath);
    this.validatePath(fullPath);

    return this.buildTree(fullPath, depth);
  }

  private buildTree(dirPath: string, depth: number, currentDepth: number = 0): any {
    if (currentDepth >= depth) return null;

    const stats = fs.statSync(dirPath);
    const name = path.basename(dirPath);

    if (!stats.isDirectory()) {
      return { name, type: 'file', size: stats.size };
    }

    const children: any[] = [];
    try {
      const entries = fs.readdirSync(dirPath);
      for (const entry of entries) {
        if (entry.startsWith('.')) continue;
        const childPath = path.join(dirPath, entry);
        const child = this.buildTree(childPath, depth, currentDepth + 1);
        if (child) children.push(child);
      }
    } catch {
      // Skip directories we can't access
    }

    return { name, type: 'directory', children };
  }

  // ===========================================================================
  // FILE WATCHING
  // ===========================================================================

  async watch(filePath: string, callback?: (event: WatchEvent) => void): Promise<string> {
    const fullPath = this.resolvePath(filePath);
    this.validatePath(fullPath);

    const watchId = nanoid();

    const watcher = fs.watch(fullPath, { recursive: true }, (eventType, filename) => {
      const event: WatchEvent = {
        type: eventType === 'rename' ? 'change' : 'change',
        path: filename ? path.join(fullPath, filename) : fullPath,
        timestamp: new Date(),
      };

      this.events.emit('watch:event', { watchId, event });
      callback?.(event);
    });

    this.watchers.set(watchId, watcher);
    return watchId;
  }

  async unwatch(watchId: string): Promise<void> {
    const watcher = this.watchers.get(watchId);
    if (watcher) {
      watcher.close();
      this.watchers.delete(watchId);
    }
  }

  // ===========================================================================
  // SEARCH
  // ===========================================================================

  async search(pattern: string, directory: string = '.'): Promise<FileInfo[]> {
    const fullPath = this.resolvePath(directory);
    this.validatePath(fullPath);

    const results: FileInfo[] = [];
    const regex = new RegExp(pattern.replace(/\*/g, '.*'), 'i');

    await this.searchRecursive(fullPath, regex, results);
    return results;
  }

  private async searchRecursive(dir: string, pattern: RegExp, results: FileInfo[]): Promise<void> {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (pattern.test(entry.name)) {
          try {
            const info = await this.getInfo(fullPath);
            results.push(info);
          } catch {
            // Skip inaccessible files
          }
        }

        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          await this.searchRecursive(fullPath, pattern, results);
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  async grep(pattern: string, filePath: string): Promise<{ line: number; content: string }[]> {
    const content = await this.read(filePath);
    const lines = content.split('\n');
    const regex = new RegExp(pattern, 'i');
    const matches: { line: number; content: string }[] = [];

    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        matches.push({ line: i + 1, content: lines[i] });
      }
    }

    return matches;
  }

  // ===========================================================================
  // ARCHIVE OPERATIONS
  // ===========================================================================

  async zip(source: string, destination: string): Promise<FileInfo> {
    const srcPath = this.resolvePath(source);
    const destPath = this.resolvePath(destination);
    this.validatePath(srcPath);
    this.validatePath(destPath);

    // Use native zip command
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    await execAsync(`zip -r "${destPath}" "${srcPath}"`);
    return this.getInfo(destination);
  }

  async unzip(source: string, destination: string): Promise<void> {
    const srcPath = this.resolvePath(source);
    const destPath = this.resolvePath(destination);
    this.validatePath(srcPath);
    this.validatePath(destPath);

    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    await execAsync(`unzip -o "${srcPath}" -d "${destPath}"`);
  }

  // ===========================================================================
  // CHECKSUMS
  // ===========================================================================

  async checksum(filePath: string, algorithm: 'md5' | 'sha256' = 'sha256'): Promise<string> {
    const buffer = await this.readBinary(filePath);
    const hash = crypto.createHash(algorithm);
    hash.update(buffer);
    return hash.digest('hex');
  }

  // ===========================================================================
  // CLOUD SYNC (Stubs - implement with actual SDKs)
  // ===========================================================================

  async uploadToCloud(
    localPath: string,
    remotePath: string,
    provider: 'gdrive' | 'dropbox' | 's3'
  ): Promise<string> {
    const fullPath = this.resolvePath(localPath);
    this.validatePath(fullPath);

    // Check if provider is configured
    const providerConfig = this.config.cloudProviders?.find(p => p.provider === provider);
    if (!providerConfig) {
      throw new Error(`Cloud provider not configured: ${provider}`);
    }

    // In production, use actual SDK
    switch (provider) {
      case 'gdrive':
        // Use Google Drive API
        throw new Error('Google Drive upload not implemented - configure GOOGLE_DRIVE_CREDENTIALS');
      case 'dropbox':
        // Use Dropbox API
        throw new Error('Dropbox upload not implemented - configure DROPBOX_ACCESS_TOKEN');
      case 's3':
        // Use AWS S3 SDK
        throw new Error('S3 upload not implemented - configure AWS_ACCESS_KEY_ID');
      default:
        throw new Error(`Unknown cloud provider: ${provider}`);
    }
  }

  async downloadFromCloud(
    remotePath: string,
    localPath: string,
    provider: 'gdrive' | 'dropbox' | 's3'
  ): Promise<FileInfo> {
    const fullPath = this.resolvePath(localPath);
    this.validatePath(fullPath);

    const providerConfig = this.config.cloudProviders?.find(p => p.provider === provider);
    if (!providerConfig) {
      throw new Error(`Cloud provider not configured: ${provider}`);
    }

    switch (provider) {
      case 'gdrive':
        throw new Error('Google Drive download not implemented');
      case 'dropbox':
        throw new Error('Dropbox download not implemented');
      case 's3':
        throw new Error('S3 download not implemented');
      default:
        throw new Error(`Unknown cloud provider: ${provider}`);
    }
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private resolvePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    if (filePath.startsWith('~')) {
      return path.join(os.homedir(), filePath.slice(1));
    }
    return path.join(this.config.workingDir!, filePath);
  }

  private validatePath(fullPath: string): void {
    const normalized = path.normalize(fullPath);

    if (this.config.sandboxed) {
      const workingDir = this.config.workingDir!;
      const homeDir = os.homedir();
      const tmpDir = os.tmpdir();

      const allowed = [workingDir, homeDir, tmpDir].some(dir =>
        normalized.startsWith(dir)
      );

      if (!allowed) {
        throw new Error(`Path outside allowed directories: ${fullPath}`);
      }
    }

    for (const blocked of this.config.blockedPaths || []) {
      if (normalized.startsWith(blocked) || normalized.includes(blocked)) {
        throw new Error(`Access to ${blocked} is not allowed`);
      }
    }
  }

  private getMimeType(ext: string): string | undefined {
    const mimeTypes: Record<string, string> = {
      '.txt': 'text/plain',
      '.json': 'application/json',
      '.js': 'application/javascript',
      '.ts': 'application/typescript',
      '.html': 'text/html',
      '.css': 'text/css',
      '.md': 'text/markdown',
      '.pdf': 'application/pdf',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.mp3': 'audio/mpeg',
      '.mp4': 'video/mp4',
      '.zip': 'application/zip',
      '.tar': 'application/x-tar',
      '.gz': 'application/gzip',
    };
    return mimeTypes[ext.toLowerCase()];
  }

  private trackOperation(id: string, type: FileOperation['type'], source: string, destination?: string): void {
    this.operations.set(id, {
      id,
      type,
      source,
      destination,
      status: 'in_progress',
      timestamp: new Date(),
    });
  }

  private completeOperation(id: string): void {
    const op = this.operations.get(id);
    if (op) {
      op.status = 'completed';
    }
  }

  private failOperation(id: string, error: string): void {
    const op = this.operations.get(id);
    if (op) {
      op.status = 'failed';
      op.error = error;
    }
  }

  private async copyDir(src: string, dest: string): Promise<void> {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  async shutdown(): Promise<void> {
    console.log('🐙 Files Tentacle shutting down...');

    for (const [id, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();

    this.registration.status = 'disabled';
    console.log('🐙 Files Tentacle offline');
  }

  // ===========================================================================
  // CAPABILITIES
  // ===========================================================================

  private buildCapabilities(): TentacleCapability[] {
    return [
      {
        name: 'read',
        description: 'Read file contents',
        permissionLevel: PermissionLevel.L0_READ,
        parameters: {
          path: { type: 'string', description: 'File path', required: true },
        },
        handler: async (params) => this.read(params.path as string),
      },
      {
        name: 'write',
        description: 'Write content to a file',
        permissionLevel: PermissionLevel.L1_WRITE_LOCAL,
        parameters: {
          path: { type: 'string', description: 'File path', required: true },
          content: { type: 'string', description: 'File content', required: true },
        },
        handler: async (params) => this.write(params.path as string, params.content as string),
      },
      {
        name: 'copy',
        description: 'Copy a file or directory',
        permissionLevel: PermissionLevel.L1_WRITE_LOCAL,
        parameters: {
          source: { type: 'string', description: 'Source path', required: true },
          destination: { type: 'string', description: 'Destination path', required: true },
        },
        handler: async (params) => this.copy(params.source as string, params.destination as string),
      },
      {
        name: 'move',
        description: 'Move/rename a file or directory',
        permissionLevel: PermissionLevel.L1_WRITE_LOCAL,
        parameters: {
          source: { type: 'string', description: 'Source path', required: true },
          destination: { type: 'string', description: 'Destination path', required: true },
        },
        handler: async (params) => this.move(params.source as string, params.destination as string),
      },
      {
        name: 'delete',
        description: 'Delete a file or directory',
        permissionLevel: PermissionLevel.L4_DESTRUCTIVE,
        parameters: {
          path: { type: 'string', description: 'Path to delete', required: true },
          recursive: { type: 'boolean', description: 'Delete recursively', required: false },
        },
        handler: async (params) => this.delete(params.path as string, params.recursive as boolean),
      },
      {
        name: 'list',
        description: 'List directory contents',
        permissionLevel: PermissionLevel.L0_READ,
        parameters: {
          path: { type: 'string', description: 'Directory path', required: false },
        },
        handler: async (params) => this.list(params.path as string),
      },
      {
        name: 'search',
        description: 'Search for files matching a pattern',
        permissionLevel: PermissionLevel.L0_READ,
        parameters: {
          pattern: { type: 'string', description: 'Search pattern (supports wildcards)', required: true },
          directory: { type: 'string', description: 'Directory to search', required: false },
        },
        handler: async (params) => this.search(params.pattern as string, params.directory as string),
      },
      {
        name: 'grep',
        description: 'Search for pattern in file contents',
        permissionLevel: PermissionLevel.L0_READ,
        parameters: {
          pattern: { type: 'string', description: 'Search pattern', required: true },
          file: { type: 'string', description: 'File to search', required: true },
        },
        handler: async (params) => this.grep(params.pattern as string, params.file as string),
      },
      {
        name: 'watch',
        description: 'Watch a file or directory for changes',
        permissionLevel: PermissionLevel.L0_READ,
        parameters: {
          path: { type: 'string', description: 'Path to watch', required: true },
        },
        handler: async (params) => this.watch(params.path as string),
      },
      {
        name: 'checksum',
        description: 'Calculate file checksum',
        permissionLevel: PermissionLevel.L0_READ,
        parameters: {
          path: { type: 'string', description: 'File path', required: true },
          algorithm: { type: 'string', description: 'Hash algorithm (md5, sha256)', required: false },
        },
        handler: async (params) => this.checksum(params.path as string, params.algorithm as any),
      },
      {
        name: 'zip',
        description: 'Create a zip archive',
        permissionLevel: PermissionLevel.L1_WRITE_LOCAL,
        parameters: {
          source: { type: 'string', description: 'Source path', required: true },
          destination: { type: 'string', description: 'Destination zip file', required: true },
        },
        handler: async (params) => this.zip(params.source as string, params.destination as string),
      },
      {
        name: 'cloud_upload',
        description: 'Upload file to cloud storage',
        permissionLevel: PermissionLevel.L2_COMM_EXTERNAL,
        parameters: {
          localPath: { type: 'string', description: 'Local file path', required: true },
          remotePath: { type: 'string', description: 'Remote path', required: true },
          provider: { type: 'string', description: 'Cloud provider (gdrive, dropbox, s3)', required: true },
        },
        handler: async (params) => this.uploadToCloud(
          params.localPath as string,
          params.remotePath as string,
          params.provider as any
        ),
      },
    ];
  }
}

export default FilesTentacle;
