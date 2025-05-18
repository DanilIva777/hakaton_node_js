FROM node:18
WORKDIR /app
COPY . .
RUN npm install
EXPOSE 443
CMD ["node", "server.js"]