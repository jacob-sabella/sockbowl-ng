# Use official nginx image as the base image
FROM nginx:latest

# Set working directory to nginx asset directory
WORKDIR /usr/share/nginx/html

# Remove default nginx static assets
RUN rm -rf ./*

# Copy static assets from your local Angular build
# Replace /path/to/your/local/angular/dist/sockbowl-ng with the path to your built Angular app
COPY ./dist/sockbowl-ng .

# Expose port 80
EXPOSE 80

# Containers run nginx with global directives and daemon off
ENTRYPOINT ["nginx", "-g", "daemon off;"]
