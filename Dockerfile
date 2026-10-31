FROM node:26.13.0-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && rm -rf node_modules/typescript node_modules/@typescript node_modules/.bin/tsc node_modules/.bin/tsserver
FROM node:26.13.0-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8096
CMD ["node", "src/server.ts"]
