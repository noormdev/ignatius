#!/bin/sh
# ignatius installer — download the prebuilt CLI binary for this platform.
#
#   curl -fsSL https://raw.githubusercontent.com/noormdev/ignatius/main/install.sh | sh
#
# Environment overrides:
#   IGNATIUS_VERSION       release tag to install (default: latest), e.g. v0.2.0
#   IGNATIUS_INSTALL_DIR   target directory (default: /usr/local/bin if writable,
#                          otherwise $HOME/.local/bin)
#
# Windows is not covered by this script — download ignatius-windows-x64.exe from
# the releases page directly.

set -eu

REPO="noormdev/ignatius"
BIN="ignatius"

say()  { printf 'ignatius: %s\n' "$1"; }
err()  { printf 'ignatius: error: %s\n' "$1" >&2; exit 1; }

# Download URL -> DEST using whichever fetcher is present.
download() {
  url="$1"; dest="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$dest"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$dest" "$url"
  else
    err "need curl or wget to download"
  fi
}

# Compare the binary's sha256 against the asset's line in checksums.txt.
verify_checksum() {
  workdir="$1"; asset="$2"
  expected="$(awk -v a="$asset" '$2 == a { print $1 }' "$workdir/checksums.txt" | head -n1)"
  if [ -z "$expected" ]; then
    say "no checksum entry for $asset — skipping verification"
    return 0
  fi
  if command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$workdir/$BIN" | awk '{ print $1 }')"
  elif command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$workdir/$BIN" | awk '{ print $1 }')"
  else
    say "no sha256 tool found — skipping verification"
    return 0
  fi
  [ "$expected" = "$actual" ] || err "checksum mismatch for $asset (expected $expected, got $actual)"
  say "checksum verified"
}

main() {
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Darwin) os="darwin" ;;
    Linux)  os="linux" ;;
    *) err "unsupported OS '$os' — Windows users: download ignatius-windows-x64.exe from https://github.com/$REPO/releases/latest" ;;
  esac

  case "$arch" in
    arm64|aarch64) arch="arm64" ;;
    x86_64|amd64)  arch="x64" ;;
    *) err "unsupported architecture '$arch'" ;;
  esac

  asset="ignatius-${os}-${arch}"

  version="${IGNATIUS_VERSION:-latest}"
  if [ "$version" = "latest" ]; then
    base="https://github.com/$REPO/releases/latest/download"
  else
    base="https://github.com/$REPO/releases/download/$version"
  fi

  # Resolve the install directory.
  dir="${IGNATIUS_INSTALL_DIR:-}"
  if [ -z "$dir" ]; then
    if [ -d /usr/local/bin ] && [ -w /usr/local/bin ]; then
      dir="/usr/local/bin"
    else
      dir="$HOME/.local/bin"
    fi
  fi
  mkdir -p "$dir" || err "cannot create install dir: $dir"

  workdir="$(mktemp -d)"
  trap 'rm -rf "$workdir"' EXIT INT TERM

  say "downloading $asset ($version)"
  download "$base/$asset" "$workdir/$BIN" || err "download failed — does release '$version' have binaries attached? see https://github.com/$REPO/releases"

  if download "$base/checksums.txt" "$workdir/checksums.txt" 2>/dev/null; then
    verify_checksum "$workdir" "$asset"
  else
    say "checksums.txt unavailable — skipping verification"
  fi

  chmod +x "$workdir/$BIN"
  mv "$workdir/$BIN" "$dir/$BIN" || err "could not install to $dir (try: IGNATIUS_INSTALL_DIR=\$HOME/.local/bin, or run with sudo)"

  say "installed to $dir/$BIN"
  case ":$PATH:" in
    *":$dir:"*) ;;
    *) say "note: $dir is not on your PATH — add it with: export PATH=\"$dir:\$PATH\"" ;;
  esac

  if "$dir/$BIN" --version >/dev/null 2>&1; then
    say "run '$BIN --help' to get started"
  fi
}

main "$@"
