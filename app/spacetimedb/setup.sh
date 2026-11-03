#!/bin/bash
# SpacetimeDB EC2 Setup Script for Tower Defense
#
# This script sets up a self-hosted SpacetimeDB server on Amazon Linux 2023
# with Nginx as a reverse proxy and Let's Encrypt SSL certificates.
#
# Prerequisites:
# - EC2 instance running Amazon Linux 2023
# - Domain name pointing to the EC2 instance (e.g., spacetimedb.theninja-rpg.com)
# - Security group allowing ports 22 (SSH), 80 (HTTP), 443 (HTTPS)
#
# Usage:
# 1. SSH into your EC2 instance
# 2. Clone the repository or copy this folder
# 3. Run: chmod +x setup.sh && ./setup.sh
# 4. Follow the prompts for SSL certificate setup

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SPACETIME_VERSION=$(sed -n 's/^spacetimedb = "=\([^"]*\)"/\1/p' "$SCRIPT_DIR/Cargo.toml")
if [ -z "$SPACETIME_VERSION" ]; then
    echo "Cargo.toml must pin the SpacetimeDB module version" >&2
    exit 1
fi

echo "=========================================="
echo "SpacetimeDB EC2 Setup Script"
echo "=========================================="

# Configuration - UPDATE THESE VALUES
DOMAIN="${SPACETIMEDB_DOMAIN:-spacetimedb.theninja-rpg.com}"
MODULE_NAME="towerdefense"
SPACETIMEDB_PORT=3000
INSTALL_DIR="/opt/spacetimedb"

echo "Domain: $DOMAIN"
echo "Module: $MODULE_NAME"

# Check if this is a re-run and show previous domain
if [ -f "$INSTALL_DIR/current_domain" ]; then
    PREVIOUS_DOMAIN=$(cat "$INSTALL_DIR/current_domain" 2>/dev/null || echo "")
    if [ -n "$PREVIOUS_DOMAIN" ] && [ "$PREVIOUS_DOMAIN" != "$DOMAIN" ]; then
        echo ""
        echo "WARNING: Domain changed from '$PREVIOUS_DOMAIN' to '$DOMAIN'"
        echo "         You will need to run certbot again for the new domain."
    fi
fi
echo ""

# Stop existing services if running (for re-runs with different config)
echo "[0/9] Stopping existing services (if any)..."
sudo systemctl stop nginx 2>/dev/null || true
sudo systemctl stop spacetimedb 2>/dev/null || true

# Update system packages
echo "[1/9] Updating system packages..."
sudo dnf update -y

# Install required packages. Amazon Linux 2023's curl-minimal covers every download
# and HTTP check below.
echo "[2/9] Installing required packages..."
sudo dnf install -y git gcc gcc-c++ make openssl-devel pkg-config tar gzip

# Install Rust (required for building modules)
echo "[3/9] Installing Rust..."
if command -v rustc &> /dev/null; then
    echo "Rust already installed: $(rustc --version)"
else
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
fi

# Ensure cargo is in PATH for this session
export PATH="$HOME/.cargo/bin:$PATH"

# Add wasm32 target for SpacetimeDB modules
echo "[4/9] Adding wasm32 target..."
rustup target add wasm32-unknown-unknown

# Install SpacetimeDB CLI
echo "[5/9] Installing SpacetimeDB CLI..."
if command -v spacetime &> /dev/null; then
    echo "SpacetimeDB CLI already installed: $(spacetime --version)"
else
    curl -sSf https://install.spacetimedb.com | sh
fi

# Ensure spacetime is in PATH
export PATH="$HOME/.local/bin:$PATH"
source "$HOME/.bashrc" 2>/dev/null || true

# Create SpacetimeDB data directory
echo "[6/9] Setting up SpacetimeDB directories..."
sudo mkdir -p $INSTALL_DIR/data
sudo mkdir -p $INSTALL_DIR/logs
sudo chown -R $USER:$USER $INSTALL_DIR

# Find the actual spacetime binary path
spacetime version install "$SPACETIME_VERSION" --yes
SPACETIME_BIN="${XDG_DATA_HOME:-$HOME/.local/share}/spacetime/bin/$SPACETIME_VERSION/spacetimedb-cli"
echo "SpacetimeDB binary: $SPACETIME_BIN"

# Create systemd service for SpacetimeDB
echo "[7/9] Creating systemd service..."
sudo tee /etc/systemd/system/spacetimedb.service > /dev/null << EOF
[Unit]
Description=SpacetimeDB Server
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
Environment="PATH=$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin"
Environment="HOME=$HOME"
ExecStart=$SPACETIME_BIN start --listen-addr 127.0.0.1:$SPACETIMEDB_PORT
Restart=always
RestartSec=10
StandardOutput=append:$INSTALL_DIR/logs/spacetimedb.log
StandardError=append:$INSTALL_DIR/logs/spacetimedb.log

[Install]
WantedBy=multi-user.target
EOF

# Enable and restart SpacetimeDB service (restart handles both fresh and re-run cases)
sudo systemctl daemon-reload
sudo systemctl enable spacetimedb
sudo systemctl restart spacetimedb

# Wait for SpacetimeDB to start and verify it's running
echo "Waiting for SpacetimeDB to start..."
sleep 5

# Check if SpacetimeDB is running
for i in {1..10}; do
    if curl -s http://127.0.0.1:$SPACETIMEDB_PORT/database/ping > /dev/null 2>&1; then
        echo "SpacetimeDB is running!"
        break
    fi
    if [ $i -eq 10 ]; then
        echo "Warning: Could not verify SpacetimeDB is running. Check logs with: sudo journalctl -u spacetimedb -n 50"
    fi
    echo "Waiting for SpacetimeDB... (attempt $i/10)"
    sleep 2
done

# Build and publish the module
echo "[8/9] Building and publishing Tower Defense module..."
cd "$SCRIPT_DIR"

# Build the module
echo "Building module..."
$SPACETIME_BIN build

# Publish to local server
echo "Publishing module to local server..."
$SPACETIME_BIN publish --server http://127.0.0.1:$SPACETIMEDB_PORT $MODULE_NAME

echo "Module published successfully!"

# Install and configure Nginx
echo "[9/9] Setting up Nginx..."
sudo dnf install -y nginx
sudo systemctl enable nginx

# Always copy fresh Nginx configuration from source (handles domain changes on re-run)
# and replace its server_name with $DOMAIN
echo "Copying fresh Nginx configuration..."
sudo cp -f "$SCRIPT_DIR/nginx.conf" /etc/nginx/nginx.conf

# A generic pattern matches whichever domain the copied file names
sudo sed -i "s/server_name  .*/server_name  $DOMAIN;/g" /etc/nginx/nginx.conf

# Test nginx configuration before restarting
echo "Testing Nginx configuration..."
if sudo nginx -t; then
    echo "Nginx configuration is valid"
    sudo systemctl restart nginx
else
    echo "ERROR: Nginx configuration is invalid. Check /etc/nginx/nginx.conf"
    exit 1
fi

# Save the current domain for reference
echo "$DOMAIN" | sudo tee $INSTALL_DIR/current_domain > /dev/null

echo ""
echo "=========================================="
echo "SpacetimeDB server is now running!"
echo "=========================================="
echo ""
echo "Domain: $DOMAIN"
echo ""
echo "Next steps:"
echo "1. Set up SSL certificate with Certbot (required for wss://):"
echo "   sudo dnf install -y python3-pip"
echo "   sudo pip3 install certbot certbot-nginx"
echo "   sudo certbot --nginx -d $DOMAIN"
echo ""
echo "2. Set up automatic certificate renewal:"
echo "   echo '0 0,12 * * * root python3 -c \"import random; import time; time.sleep(random.random() * 3600)\" && certbot renew -q' | sudo tee -a /etc/crontab > /dev/null"
echo ""
echo "3. Update your game's environment variable:"
echo "   NEXT_PUBLIC_SPACETIMEDB_HOST=wss://$DOMAIN"
echo ""
echo "4. To view logs:"
echo "   sudo journalctl -u spacetimedb -f"
echo "   tail -f $INSTALL_DIR/logs/spacetimedb.log"
echo ""
echo "5. To republish the module after changes:"
echo "   spacetime publish --server http://127.0.0.1:$SPACETIMEDB_PORT $MODULE_NAME"
echo ""
echo "NOTE: If you changed the domain, you'll need to run certbot again for the new domain."
echo ""
