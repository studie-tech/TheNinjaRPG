# Update yum
sudo yum update -y

# Install required packages
sudo yum install -y git python3 gcc

# Install nodejs
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.7/install.sh | bash
. ~/.nvm/nvm.sh
nvm install 24
nvm use 24
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