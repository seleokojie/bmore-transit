# Build
FROM node:20 AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

# Serve
FROM nginx:alpine
WORKDIR /usr/share/nginx/html
RUN rm -rf ./*
COPY --from=build /app/dist/web-angular/browser/* .

# Inject runtime env into env.js for the app to read
RUN mkdir -p /docker-entrypoint.d
ADD docker-entrypoint.d/99-env.sh /docker-entrypoint.d/99-env.sh
RUN chmod +x /docker-entrypoint.d/99-env.sh
EXPOSE 80
