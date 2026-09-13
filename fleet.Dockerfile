FROM node:22-alpine
RUN apk add --no-cache git openssh-client python3
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY fleet ./fleet
ENV FLEET_PORT=3100
EXPOSE 3100
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://localhost:3100/api/fleet/health || exit 1
CMD ["node", "fleet/run.js"]
