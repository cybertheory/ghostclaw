#!/usr/bin/env bash
# Run this in your terminal (requires your password for sudo).
# Needed so the GhostClaw Rust build can compile the macOS nspanel (cidre) dependency.

set -e

if [[ ! -d /Applications/Xcode.app ]]; then
  echo "Xcode is not installed. Install it from the App Store first:"
  echo "  https://apps.apple.com/app/xcode/id497799835"
  exit 1
fi

echo "Setting active developer directory to Xcode..."
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer

echo "Accepting Xcode license (if prompted)..."
sudo xcodebuild -license accept 2>/dev/null || true

echo "Done. You can now run: cd $(dirname "$0")/.. && npm run tauri dev"
