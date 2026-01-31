# Homebrew formula for Octpus
#
# To install from local tap:
#   brew tap sebbsssss/octpus https://github.com/sebbsssss/octpusbot
#   brew install octpus
#
# Or direct install:
#   brew install sebbsssss/octpus/octpus

class Octpus < Formula
  desc "Autonomous AI agent - 8 arms, infinite reach"
  homepage "https://github.com/sebbsssss/octpusbot"
  version "0.1.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/sebbsssss/octpusbot/releases/download/v#{version}/octpus-darwin-arm64.tar.gz"
      sha256 "PLACEHOLDER_SHA256_DARWIN_ARM64"
    end

    on_intel do
      url "https://github.com/sebbsssss/octpusbot/releases/download/v#{version}/octpus-darwin-x64.tar.gz"
      sha256 "PLACEHOLDER_SHA256_DARWIN_X64"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/sebbsssss/octpusbot/releases/download/v#{version}/octpus-linux-arm64.tar.gz"
      sha256 "PLACEHOLDER_SHA256_LINUX_ARM64"
    end

    on_intel do
      url "https://github.com/sebbsssss/octpusbot/releases/download/v#{version}/octpus-linux-x64.tar.gz"
      sha256 "PLACEHOLDER_SHA256_LINUX_X64"
    end
  end

  def install
    bin.install "octpus"
  end

  def caveats
    <<~EOS
      To get started, run:
        octpus setup

      You'll need an Anthropic API key from:
        https://console.anthropic.com

      Config is stored at:
        ~/.octpus/config.json

      For background agent:
        octpus daemon start
    EOS
  end

  test do
    assert_match "octpus v#{version}", shell_output("#{bin}/octpus version")
  end
end
