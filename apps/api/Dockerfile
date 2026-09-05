# syntax=docker/dockerfile:1
FROM node:24-alpine

# Prisma engines need OpenSSL on alpine
RUN apk add --no-cache openssl libc6-compat

WORKDIR /repo

EXPOSE 3000

CMD ["npm", "run", "dev", "-w", "@dealflow/api"]
