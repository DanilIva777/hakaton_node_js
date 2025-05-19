

FROM nginx:latest

# Copy certificates into the image (assumes certificates are available during build)
COPY /etc/letsencrypt/live/hyper-ist.mooo.com/fullchain.pem /etc/nginx/fullchain.pem
COPY /etc/letsencrypt/live/hyper-ist.mooo.com/privkey.pem /etc/nginx/privkey.pem

# Embed Nginx configuration with HTTP and HTTPS
RUN echo '\
events {}\n\
http {\n\
    server {\n\
        listen 443 ssl;\n\
        server_name hyper-ist.mooo.com;\n\
        ssl_certificate /etc/nginx/fullchain.pem;\n\
        ssl_certificate_key /etc/nginx/privkey.pem;\n\
        server_name hyper-ist.mooo.com;\n\
\n\
        location /api/ {\n\
            proxy_pass http://main-service:3000/;\n\
            proxy_set_header Host $host;\n\
            proxy_set_header X-Real-IP $remote_addr;\n\
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n\
            proxy_set_header X-Forwarded-Proto $scheme;\n\
        }\n\
\n\
        location / {\n\
            return 404;\n\
        }\n\
    }\n\
}\n\
' > /etc/nginx/nginx.conf

# Ensure Nginx runs in the foreground
CMD ["nginx", "-g", "daemon off;"]