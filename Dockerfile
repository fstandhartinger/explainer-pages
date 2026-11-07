FROM node:22-alpine
# eMudhra CA distrust (Oct 2026): current CA bundle, and make Node trust it instead of its bundled root list
RUN apk add --no-cache --upgrade ca-certificates-bundle
ENV NODE_OPTIONS="--use-openssl-ca"
WORKDIR /app
COPY server.js copy-tools.js artifact-badges.js cards.enc bundle.enc.* ./
ENV PORT=8080 NODE_ENV=production
EXPOSE 8080
USER node
CMD ["node", "server.js"]
