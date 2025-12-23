# Use official nginx image as the base image
FROM nginx:latest

# Install envsubst (part of gettext-base package)
RUN apt-get update && apt-get install -y gettext-base && rm -rf /var/lib/apt/lists/*

# Set working directory to nginx asset directory
WORKDIR /usr/share/nginx/html

# Remove default nginx static assets
RUN rm -rf ./*

# Copy static assets from your local Angular build
COPY ./dist/sockbowl-ng .

# Copy the entrypoint script
COPY ./docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Create a custom Nginx config file
RUN echo 'server {' \
        'listen       80;' \
        'server_name  localhost;' \
        'location / {' \
            'root   /usr/share/nginx/html;' \
            'index  index.html index.htm;' \
            'try_files $uri $uri/ /index.html;' \
        '}' \
        'error_page   500 502 503 504  /50x.html;' \
        'location = /50x.html {' \
            'root   /usr/share/nginx/html;' \
        '}' \
    '}' > /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Use custom entrypoint that generates config.js from environment variables
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
