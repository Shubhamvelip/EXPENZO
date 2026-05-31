#!/bin/bash

# Expenzo Setup Script
# This script sets up the Expenzo application by installing dependencies

echo "╔═══════════════════════════════════════╗"
echo "║  Expenzo - Setup Installation Script  ║"
echo "╚═══════════════════════════════════════╝"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Python is installed
echo "Checking Python installation..."
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}✗ Python 3 is not installed${NC}"
    echo "Please install Python 3.9 or higher from https://www.python.org/downloads/"
    exit 1
fi
PYTHON_VERSION=$(python3 --version 2>&1 | awk '{print $2}')
echo -e "${GREEN}✓ Python $PYTHON_VERSION found${NC}"
echo ""

# Check if Node.js is installed
echo "Checking Node.js installation..."
if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Node.js is not installed${NC}"
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi
NODE_VERSION=$(node --version)
echo -e "${GREEN}✓ Node.js $NODE_VERSION found${NC}"
echo ""

# Install backend dependencies
echo "Installing Python backend dependencies..."
if [ -f "requirements.txt" ]; then
    pip install -r requirements.txt
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Backend dependencies installed${NC}"
    else
        echo -e "${RED}✗ Failed to install backend dependencies${NC}"
        exit 1
    fi
else
    echo -e "${RED}✗ requirements.txt not found${NC}"
    exit 1
fi
echo ""

# Setup environment file
echo "Setting up environment configuration..."
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo -e "${YELLOW}⚠ .env file created from .env.example${NC}"
        echo "Please edit .env with your actual credentials:"
        echo "  - SUPABASE_URL"
        echo "  - SUPABASE_KEY"
        echo "  - GOOGLE_API_KEY"
    fi
else
    echo -e "${GREEN}✓ .env file exists${NC}"
fi
echo ""

# Install frontend dependencies
echo "Installing frontend dependencies..."
cd expenzo-client
if npm install; then
    echo -e "${GREEN}✓ Frontend dependencies installed${NC}"
else
    echo -e "${RED}✗ Failed to install frontend dependencies${NC}"
    exit 1
fi
cd ..
echo ""

echo "╔═══════════════════════════════════════╗"
echo "║  Setup Complete!                      ║"
echo "╚═══════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo "1. Edit .env with your Supabase and Google API credentials"
echo "2. Start backend:   python main.py"
echo "3. Start frontend:  cd expenzo-client && npm start"
echo ""
echo "For detailed instructions, see README.md"
