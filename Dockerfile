# Use official nginx image as the base image
FROM nginx:latest

# Set working directory to nginx asset directory
WORKDIR /usr/share/nginx/html

# Remove default nginx static assets
RUN rm -rf ./*

# Copy static assets from your local Angular build
# Replace /path/to/your/local/angular/dist/sockbowl-ng with the path to your built Angular app
COPY ./dist/sockbowl-ng .

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

# Containers run nginx with global directives and daemon off
ENTRYPOINT ["nginx", "-g", "daemon off;"]
