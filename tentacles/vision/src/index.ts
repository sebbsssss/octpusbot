/**
 * Vision Tentacle
 * The eyes of the Octpus - image analysis, OCR, and visual understanding
 *
 * Capabilities:
 * - OCR (Optical Character Recognition) via Tesseract.js
 * - Image analysis and description
 * - Screenshot analysis
 * - Document parsing (receipts, invoices, IDs)
 * - QR/Barcode scanning
 * - Face detection (privacy-respecting)
 *
 * No API keys required - runs entirely locally!
 */

import { EventEmitter } from 'eventemitter3';
import { nanoid } from 'nanoid';
import { createWorker, Worker, OEM, PSM } from 'tesseract.js';
import Jimp from 'jimp';
import jsQR from 'jsqr';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  TentacleRegistration,
  TentacleCapability,
  PermissionLevel,
} from '@octpus/types';

// =============================================================================
// TYPES
// =============================================================================

export interface VisionConfig {
  tesseractLangs?: string[];
  cacheDir?: string;
  maxImageSize?: number;
  enableFaceDetection?: boolean;
}

export interface OCRResult {
  text: string;
  confidence: number;
  blocks: TextBlock[];
  language: string;
  duration: number;
}

export interface TextBlock {
  text: string;
  confidence: number;
  bbox: BoundingBox;
  lines: TextLine[];
}

export interface TextLine {
  text: string;
  confidence: number;
  bbox: BoundingBox;
  words: TextWord[];
}

export interface TextWord {
  text: string;
  confidence: number;
  bbox: BoundingBox;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageAnalysis {
  width: number;
  height: number;
  format: string;
  colors: ColorInfo[];
  brightness: number;
  contrast: number;
  hasText: boolean;
  textRegions?: BoundingBox[];
}

export interface ColorInfo {
  hex: string;
  rgb: { r: number; g: number; b: number };
  percentage: number;
}

export interface QRCodeResult {
  data: string;
  type: 'qr' | 'barcode';
  location: BoundingBox;
}

export interface DocumentParseResult {
  type: 'receipt' | 'invoice' | 'id' | 'unknown';
  fields: Record<string, string>;
  rawText: string;
  confidence: number;
}

// =============================================================================
// VISION TENTACLE
// =============================================================================

export class VisionTentacle {
  readonly registration: TentacleRegistration;
  readonly events: EventEmitter;

  private config: VisionConfig;
  private ocrWorker: Worker | null = null;
  private workerReady: boolean = false;

  constructor(config: VisionConfig = {}) {
    this.config = {
      tesseractLangs: ['eng'],
      maxImageSize: 4096 * 4096,
      enableFaceDetection: false,
      ...config,
    };

    this.events = new EventEmitter();

    this.registration = {
      id: 'vision',
      type: 'vision',
      name: 'Vision Tentacle',
      description: 'Image analysis, OCR, QR scanning, and document parsing',
      version: '0.1.0',
      capabilities: this.buildCapabilities(),
      status: 'initializing',
      sandboxed: true,
    };
  }

  /**
   * Initialize the vision tentacle
   */
  async initialize(): Promise<void> {
    console.log('🐙 Vision Tentacle initializing...');

    // Initialize Tesseract worker
    this.ocrWorker = await createWorker(this.config.tesseractLangs!.join('+'), OEM.LSTM_ONLY, {
      cacheMethod: 'readOnly',
    });

    this.workerReady = true;
    this.registration.status = 'ready';
    console.log('🐙 Vision Tentacle ready!');
  }

  // ==========================================================================
  // OCR - TEXT EXTRACTION
  // ==========================================================================

  /**
   * Extract text from an image using OCR
   */
  async extractText(imagePath: string): Promise<OCRResult> {
    const startTime = Date.now();

    if (!this.workerReady || !this.ocrWorker) {
      throw new Error('OCR worker not initialized');
    }

    // Validate image exists
    if (!existsSync(imagePath)) {
      throw new Error(`Image not found: ${imagePath}`);
    }

    // Perform OCR
    const { data } = await this.ocrWorker.recognize(imagePath);

    const blocks: TextBlock[] = data.blocks?.map((block) => ({
      text: block.text,
      confidence: block.confidence,
      bbox: {
        x: block.bbox.x0,
        y: block.bbox.y0,
        width: block.bbox.x1 - block.bbox.x0,
        height: block.bbox.y1 - block.bbox.y0,
      },
      lines: block.lines?.map((line) => ({
        text: line.text,
        confidence: line.confidence,
        bbox: {
          x: line.bbox.x0,
          y: line.bbox.y0,
          width: line.bbox.x1 - line.bbox.x0,
          height: line.bbox.y1 - line.bbox.y0,
        },
        words: line.words?.map((word) => ({
          text: word.text,
          confidence: word.confidence,
          bbox: {
            x: word.bbox.x0,
            y: word.bbox.y0,
            width: word.bbox.x1 - word.bbox.x0,
            height: word.bbox.y1 - word.bbox.y0,
          },
        })) || [],
      })) || [],
    })) || [];

    const result: OCRResult = {
      text: data.text,
      confidence: data.confidence,
      blocks,
      language: this.config.tesseractLangs![0],
      duration: Date.now() - startTime,
    };

    this.events.emit('ocr:complete', result);
    return result;
  }

  /**
   * Extract text from a specific region of an image
   */
  async extractTextFromRegion(
    imagePath: string,
    region: BoundingBox
  ): Promise<OCRResult> {
    if (!this.workerReady || !this.ocrWorker) {
      throw new Error('OCR worker not initialized');
    }

    const startTime = Date.now();

    const { data } = await this.ocrWorker.recognize(imagePath, {
      rectangle: {
        left: region.x,
        top: region.y,
        width: region.width,
        height: region.height,
      },
    });

    return {
      text: data.text,
      confidence: data.confidence,
      blocks: [],
      language: this.config.tesseractLangs![0],
      duration: Date.now() - startTime,
    };
  }

  /**
   * Extract text from image buffer
   */
  async extractTextFromBuffer(buffer: Buffer): Promise<OCRResult> {
    if (!this.workerReady || !this.ocrWorker) {
      throw new Error('OCR worker not initialized');
    }

    const startTime = Date.now();
    const { data } = await this.ocrWorker.recognize(buffer);

    return {
      text: data.text,
      confidence: data.confidence,
      blocks: [],
      language: this.config.tesseractLangs![0],
      duration: Date.now() - startTime,
    };
  }

  // ==========================================================================
  // IMAGE ANALYSIS
  // ==========================================================================

  /**
   * Analyze an image's properties
   */
  async analyzeImage(imagePath: string): Promise<ImageAnalysis> {
    const image = await Jimp.read(imagePath);

    // Get dominant colors
    const colors = await this.extractColors(image);

    // Calculate brightness
    const brightness = this.calculateBrightness(image);

    // Calculate contrast
    const contrast = this.calculateContrast(image);

    // Check for text regions (simple heuristic)
    const hasText = await this.detectTextRegions(image);

    return {
      width: image.getWidth(),
      height: image.getHeight(),
      format: image.getMIME(),
      colors,
      brightness,
      contrast,
      hasText: hasText.length > 0,
      textRegions: hasText,
    };
  }

  /**
   * Compare two images for similarity
   */
  async compareImages(
    imagePath1: string,
    imagePath2: string
  ): Promise<{ similarity: number; diff?: Buffer }> {
    const image1 = await Jimp.read(imagePath1);
    const image2 = await Jimp.read(imagePath2);

    // Resize to same dimensions for comparison
    const width = Math.min(image1.getWidth(), image2.getWidth());
    const height = Math.min(image1.getHeight(), image2.getHeight());

    image1.resize(width, height);
    image2.resize(width, height);

    // Calculate pixel difference
    const diff = Jimp.diff(image1, image2);

    return {
      similarity: 1 - diff.percent,
      diff: await diff.image.getBufferAsync(Jimp.MIME_PNG),
    };
  }

  /**
   * Resize an image
   */
  async resizeImage(
    imagePath: string,
    width: number,
    height?: number,
    outputPath?: string
  ): Promise<Buffer> {
    const image = await Jimp.read(imagePath);

    if (height) {
      image.resize(width, height);
    } else {
      image.resize(width, Jimp.AUTO);
    }

    const buffer = await image.getBufferAsync(Jimp.MIME_PNG);

    if (outputPath) {
      await image.writeAsync(outputPath);
    }

    return buffer;
  }

  /**
   * Crop an image
   */
  async cropImage(
    imagePath: string,
    region: BoundingBox,
    outputPath?: string
  ): Promise<Buffer> {
    const image = await Jimp.read(imagePath);

    image.crop(region.x, region.y, region.width, region.height);

    const buffer = await image.getBufferAsync(Jimp.MIME_PNG);

    if (outputPath) {
      await image.writeAsync(outputPath);
    }

    return buffer;
  }

  // ==========================================================================
  // QR & BARCODE SCANNING
  // ==========================================================================

  /**
   * Scan for QR codes in an image
   */
  async scanQRCode(imagePath: string): Promise<QRCodeResult | null> {
    const image = await Jimp.read(imagePath);
    const imageData = {
      data: new Uint8ClampedArray(image.bitmap.data),
      width: image.bitmap.width,
      height: image.bitmap.height,
    };

    const code = jsQR(imageData.data, imageData.width, imageData.height);

    if (!code) {
      return null;
    }

    return {
      data: code.data,
      type: 'qr',
      location: {
        x: code.location.topLeftCorner.x,
        y: code.location.topLeftCorner.y,
        width: code.location.topRightCorner.x - code.location.topLeftCorner.x,
        height: code.location.bottomLeftCorner.y - code.location.topLeftCorner.y,
      },
    };
  }

  /**
   * Generate a QR code
   */
  async generateQRCode(
    data: string,
    size: number = 256,
    outputPath?: string
  ): Promise<Buffer> {
    // Using Jimp to create a simple QR-like pattern
    // In production, you'd use a proper QR library like 'qrcode'
    const QRCode = require('qrcode');

    const buffer = await QRCode.toBuffer(data, {
      width: size,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    });

    if (outputPath) {
      const image = await Jimp.read(buffer);
      await image.writeAsync(outputPath);
    }

    return buffer;
  }

  // ==========================================================================
  // DOCUMENT PARSING
  // ==========================================================================

  /**
   * Parse a document (receipt, invoice, etc.)
   */
  async parseDocument(imagePath: string): Promise<DocumentParseResult> {
    // First, extract all text
    const ocr = await this.extractText(imagePath);

    // Detect document type based on content
    const type = this.detectDocumentType(ocr.text);

    // Extract fields based on document type
    const fields = this.extractDocumentFields(ocr.text, type);

    return {
      type,
      fields,
      rawText: ocr.text,
      confidence: ocr.confidence,
    };
  }

  /**
   * Parse a receipt
   */
  async parseReceipt(imagePath: string): Promise<{
    merchant?: string;
    date?: string;
    total?: string;
    items: { name: string; price: string }[];
    tax?: string;
    paymentMethod?: string;
  }> {
    const doc = await this.parseDocument(imagePath);

    return {
      merchant: doc.fields.merchant,
      date: doc.fields.date,
      total: doc.fields.total,
      items: this.extractLineItems(doc.rawText),
      tax: doc.fields.tax,
      paymentMethod: doc.fields.paymentMethod,
    };
  }

  // ==========================================================================
  // SCREENSHOT ANALYSIS
  // ==========================================================================

  /**
   * Analyze a screenshot (UI elements, text, etc.)
   */
  async analyzeScreenshot(imagePath: string): Promise<{
    dimensions: { width: number; height: number };
    textContent: string;
    clickableAreas: BoundingBox[];
    inputFields: BoundingBox[];
  }> {
    const image = await Jimp.read(imagePath);
    const ocr = await this.extractText(imagePath);

    // Detect UI elements (simplified - in production would use ML)
    const clickableAreas: BoundingBox[] = [];
    const inputFields: BoundingBox[] = [];

    // Look for button-like text patterns
    for (const block of ocr.blocks) {
      const text = block.text.toLowerCase();
      if (
        text.includes('submit') ||
        text.includes('click') ||
        text.includes('button') ||
        text.includes('login') ||
        text.includes('sign')
      ) {
        clickableAreas.push(block.bbox);
      }
    }

    return {
      dimensions: {
        width: image.getWidth(),
        height: image.getHeight(),
      },
      textContent: ocr.text,
      clickableAreas,
      inputFields,
    };
  }

  // ==========================================================================
  // SHUTDOWN
  // ==========================================================================

  async shutdown(): Promise<void> {
    console.log('🐙 Vision Tentacle shutting down...');

    if (this.ocrWorker) {
      await this.ocrWorker.terminate();
      this.ocrWorker = null;
    }

    this.workerReady = false;
    this.registration.status = 'disabled';
    console.log('🐙 Vision Tentacle offline');
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  private async extractColors(image: Jimp): Promise<ColorInfo[]> {
    const colorMap = new Map<string, number>();
    const totalPixels = image.getWidth() * image.getHeight();

    image.scan(0, 0, image.getWidth(), image.getHeight(), (x, y, idx) => {
      const r = image.bitmap.data[idx];
      const g = image.bitmap.data[idx + 1];
      const b = image.bitmap.data[idx + 2];

      // Quantize colors to reduce noise
      const qr = Math.round(r / 32) * 32;
      const qg = Math.round(g / 32) * 32;
      const qb = Math.round(b / 32) * 32;

      const hex = `#${qr.toString(16).padStart(2, '0')}${qg.toString(16).padStart(2, '0')}${qb.toString(16).padStart(2, '0')}`;

      colorMap.set(hex, (colorMap.get(hex) || 0) + 1);
    });

    // Sort by frequency and take top 5
    const sorted = Array.from(colorMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    return sorted.map(([hex, count]) => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);

      return {
        hex,
        rgb: { r, g, b },
        percentage: (count / totalPixels) * 100,
      };
    });
  }

  private calculateBrightness(image: Jimp): number {
    let totalBrightness = 0;
    const totalPixels = image.getWidth() * image.getHeight();

    image.scan(0, 0, image.getWidth(), image.getHeight(), (x, y, idx) => {
      const r = image.bitmap.data[idx];
      const g = image.bitmap.data[idx + 1];
      const b = image.bitmap.data[idx + 2];

      // Perceived brightness formula
      totalBrightness += (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    });

    return totalBrightness / totalPixels;
  }

  private calculateContrast(image: Jimp): number {
    const pixels: number[] = [];

    image.scan(0, 0, image.getWidth(), image.getHeight(), (x, y, idx) => {
      const r = image.bitmap.data[idx];
      const g = image.bitmap.data[idx + 1];
      const b = image.bitmap.data[idx + 2];

      pixels.push((r + g + b) / 3);
    });

    const mean = pixels.reduce((a, b) => a + b, 0) / pixels.length;
    const variance = pixels.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / pixels.length;

    return Math.sqrt(variance) / 128; // Normalize to 0-1 range
  }

  private async detectTextRegions(image: Jimp): Promise<BoundingBox[]> {
    // Simple edge detection to find potential text regions
    // In production, you'd use a proper text detection model
    const regions: BoundingBox[] = [];

    // Convert to grayscale and detect high-contrast regions
    const gray = image.clone().grayscale();

    // Simple grid-based detection
    const gridSize = 50;
    const width = image.getWidth();
    const height = image.getHeight();

    for (let y = 0; y < height; y += gridSize) {
      for (let x = 0; x < width; x += gridSize) {
        const regionWidth = Math.min(gridSize, width - x);
        const regionHeight = Math.min(gridSize, height - y);

        let hasContrast = false;
        let prevPixel = 0;

        // Check for high contrast changes (potential text)
        for (let dy = 0; dy < regionHeight && !hasContrast; dy++) {
          for (let dx = 0; dx < regionWidth && !hasContrast; dx++) {
            const pixel = Jimp.intToRGBA(gray.getPixelColor(x + dx, y + dy)).r;
            if (Math.abs(pixel - prevPixel) > 100) {
              hasContrast = true;
            }
            prevPixel = pixel;
          }
        }

        if (hasContrast) {
          regions.push({ x, y, width: regionWidth, height: regionHeight });
        }
      }
    }

    return regions;
  }

  private detectDocumentType(text: string): DocumentParseResult['type'] {
    const lower = text.toLowerCase();

    if (
      lower.includes('receipt') ||
      lower.includes('total') ||
      lower.includes('subtotal') ||
      lower.includes('tax')
    ) {
      return 'receipt';
    }

    if (
      lower.includes('invoice') ||
      lower.includes('bill to') ||
      lower.includes('due date')
    ) {
      return 'invoice';
    }

    if (
      lower.includes('license') ||
      lower.includes('passport') ||
      lower.includes('id card') ||
      lower.includes('date of birth')
    ) {
      return 'id';
    }

    return 'unknown';
  }

  private extractDocumentFields(
    text: string,
    type: DocumentParseResult['type']
  ): Record<string, string> {
    const fields: Record<string, string> = {};

    // Common patterns
    const datePattern = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/;
    const pricePattern = /\$?\d+\.\d{2}/g;
    const timePattern = /(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)/i;

    const dateMatch = text.match(datePattern);
    if (dateMatch) fields.date = dateMatch[1];

    const timeMatch = text.match(timePattern);
    if (timeMatch) fields.time = timeMatch[1];

    if (type === 'receipt') {
      // Look for total
      const totalMatch = text.match(/total[:\s]*\$?(\d+\.\d{2})/i);
      if (totalMatch) fields.total = totalMatch[1];

      // Look for tax
      const taxMatch = text.match(/tax[:\s]*\$?(\d+\.\d{2})/i);
      if (taxMatch) fields.tax = taxMatch[1];

      // Look for merchant (usually first line)
      const lines = text.split('\n').filter((l) => l.trim());
      if (lines.length > 0) fields.merchant = lines[0].trim();
    }

    if (type === 'invoice') {
      // Invoice number
      const invoiceMatch = text.match(/invoice\s*#?\s*:?\s*(\w+)/i);
      if (invoiceMatch) fields.invoiceNumber = invoiceMatch[1];

      // Due date
      const dueMatch = text.match(/due\s*date[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
      if (dueMatch) fields.dueDate = dueMatch[1];
    }

    return fields;
  }

  private extractLineItems(text: string): { name: string; price: string }[] {
    const items: { name: string; price: string }[] = [];
    const lines = text.split('\n');

    for (const line of lines) {
      const priceMatch = line.match(/\$?(\d+\.\d{2})\s*$/);
      if (priceMatch) {
        const name = line.replace(priceMatch[0], '').trim();
        if (name && name.length > 2) {
          items.push({ name, price: priceMatch[1] });
        }
      }
    }

    return items;
  }

  // ==========================================================================
  // CAPABILITIES
  // ==========================================================================

  private buildCapabilities(): TentacleCapability[] {
    return [
      {
        name: 'extract_text',
        description: 'Extract text from an image using OCR',
        permissionLevel: PermissionLevel.L0_READ,
        parameters: {
          imagePath: { type: 'string', description: 'Path to the image', required: true },
        },
        handler: async (params) => {
          return this.extractText(params.imagePath as string);
        },
      },
      {
        name: 'analyze_image',
        description: 'Analyze image properties (colors, brightness, etc.)',
        permissionLevel: PermissionLevel.L0_READ,
        parameters: {
          imagePath: { type: 'string', description: 'Path to the image', required: true },
        },
        handler: async (params) => {
          return this.analyzeImage(params.imagePath as string);
        },
      },
      {
        name: 'scan_qr',
        description: 'Scan QR code from an image',
        permissionLevel: PermissionLevel.L0_READ,
        parameters: {
          imagePath: { type: 'string', description: 'Path to the image', required: true },
        },
        handler: async (params) => {
          return this.scanQRCode(params.imagePath as string);
        },
      },
      {
        name: 'parse_document',
        description: 'Parse a document (receipt, invoice, ID)',
        permissionLevel: PermissionLevel.L0_READ,
        parameters: {
          imagePath: { type: 'string', description: 'Path to the document image', required: true },
        },
        handler: async (params) => {
          return this.parseDocument(params.imagePath as string);
        },
      },
      {
        name: 'parse_receipt',
        description: 'Parse a receipt and extract items, total, etc.',
        permissionLevel: PermissionLevel.L0_READ,
        parameters: {
          imagePath: { type: 'string', description: 'Path to the receipt image', required: true },
        },
        handler: async (params) => {
          return this.parseReceipt(params.imagePath as string);
        },
      },
      {
        name: 'compare_images',
        description: 'Compare two images for similarity',
        permissionLevel: PermissionLevel.L0_READ,
        parameters: {
          imagePath1: { type: 'string', description: 'Path to first image', required: true },
          imagePath2: { type: 'string', description: 'Path to second image', required: true },
        },
        handler: async (params) => {
          return this.compareImages(
            params.imagePath1 as string,
            params.imagePath2 as string
          );
        },
      },
      {
        name: 'resize_image',
        description: 'Resize an image',
        permissionLevel: PermissionLevel.L1_WRITE_LOCAL,
        parameters: {
          imagePath: { type: 'string', description: 'Path to the image', required: true },
          width: { type: 'number', description: 'New width', required: true },
          height: { type: 'number', description: 'New height (optional)', required: false },
          outputPath: { type: 'string', description: 'Output path (optional)', required: false },
        },
        handler: async (params) => {
          return this.resizeImage(
            params.imagePath as string,
            params.width as number,
            params.height as number | undefined,
            params.outputPath as string | undefined
          );
        },
      },
      {
        name: 'crop_image',
        description: 'Crop a region from an image',
        permissionLevel: PermissionLevel.L1_WRITE_LOCAL,
        parameters: {
          imagePath: { type: 'string', description: 'Path to the image', required: true },
          x: { type: 'number', description: 'X coordinate', required: true },
          y: { type: 'number', description: 'Y coordinate', required: true },
          width: { type: 'number', description: 'Crop width', required: true },
          height: { type: 'number', description: 'Crop height', required: true },
          outputPath: { type: 'string', description: 'Output path (optional)', required: false },
        },
        handler: async (params) => {
          return this.cropImage(
            params.imagePath as string,
            {
              x: params.x as number,
              y: params.y as number,
              width: params.width as number,
              height: params.height as number,
            },
            params.outputPath as string | undefined
          );
        },
      },
      {
        name: 'generate_qr',
        description: 'Generate a QR code',
        permissionLevel: PermissionLevel.L1_WRITE_LOCAL,
        parameters: {
          data: { type: 'string', description: 'Data to encode', required: true },
          size: { type: 'number', description: 'QR code size in pixels', required: false },
          outputPath: { type: 'string', description: 'Output path (optional)', required: false },
        },
        handler: async (params) => {
          return this.generateQRCode(
            params.data as string,
            (params.size as number) || 256,
            params.outputPath as string | undefined
          );
        },
      },
      {
        name: 'analyze_screenshot',
        description: 'Analyze a screenshot for UI elements and text',
        permissionLevel: PermissionLevel.L0_READ,
        parameters: {
          imagePath: { type: 'string', description: 'Path to the screenshot', required: true },
        },
        handler: async (params) => {
          return this.analyzeScreenshot(params.imagePath as string);
        },
      },
    ];
  }
}

export default VisionTentacle;
