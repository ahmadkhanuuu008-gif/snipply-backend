FROM node:24-alpine

# Install FFmpeg (+fonts for caption rendering) and yt-dlp — critical, do not skip
# Use @community repo so ffmpeg is built with libx264, fdk-aac, libass etc.
RUN echo "@community http://dl-cdn.alpinelinux.org/alpine/v3.20/community" >> /etc/apk/repositories && \
    apk add --no-cache ffmpeg@community fontconfig ttf-dejavu python3 py3-pip && \
    pip3 install --no-cache-dir --break-system-packages yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3001

CMD ["node", "src/index.js"]