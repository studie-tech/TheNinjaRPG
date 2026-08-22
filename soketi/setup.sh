# Update yum
sudo yum update -y

# Install required packages
sudo yum install -y git python3 gcc

# Install nodejs
# Pinned to 18: @soketi/soketi 1.6.1 depends on uWebSockets.js v20.10.0, whose
# prebuilt addons only cover Node ABI 83/93/108 (Node 14/16/18). Anything newer
# fails at require() with "supports only Node.js 14, 16 and 18", so pm2 cannot
# start soketi. Upstream's own images are Node 16 (soketi:1.6-16-debian).
# Revisit only when soketi ships a uWebSockets.js build for a current Node ABI.
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.7/install.sh | bash
. ~/.nvm/nvm.sh
nvm install 18
nvm use 18
source ~/.bashrc
node -e "console.log('Running Node.js ' + process.version)"

# Install Soketi & pm2
npm install -g @soketi/soketi
npm install -g pm2

# Run Soketi with pm2 to keep alive
pm2 stop soketi
pm2 start soketi -- start --config=config.json

# Install nginx
sudo yum install nginx -y
sudo systemctl start nginx.service
#sudo systemctl status nginx.service

# Copy in nginx config
sudo cp -rf nginx.conf /etc/nginx/
sudo systemctl restart nginx.service

# Install certbot
sudo yum install augeas-libs -y
sudo python3 -m venv /opt/certbot/
sudo /opt/certbot/bin/pip install --upgrade pip
sudo /opt/certbot/bin/pip install certbot
sudo /opt/certbot/bin/pip install certbot-nginx
sudo ln -s /opt/certbot/bin/certbot /usr/bin/certbot
sudo certbot --nginx
echo "0 0,12 * * * root /opt/certbot/bin/python -c 'import random; import time; time.sleep(random.random() * 3600)' && sudo pm2 flush soketi && sudo certbot renew -q" | sudo tee -a /etc/crontab > /dev/null