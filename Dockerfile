# Use the official Node.js LTS-slim image for a smaller footprint.
FROM node:21-slim AS build

# Set the working directory inside the container.
WORKDIR /app

# Copy the package.json and pnpm-lock.yaml files.
COPY package.json pnpm-lock.yaml ./
COPY package.json package-lock.json ./

# Install pnpm globally.
# RUN npm install -g pnpm

# Install project dependencies using pnpm.
# RUN pnpm install
RUN npm install --only=prod

# Copy the rest of the application code.
COPY . .

# Build the Next.js app.
# RUN pnpm run build
RUN npm run build

# Stage 2: Final image with only necessary files
FROM node:21-slim AS final

WORKDIR /app


COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/public/ ./public/

# Set environment variable to production.
ENV NODE_ENV=production

# Expose the port on which your app runs.
EXPOSE 3111
ENV PORT 3111

# Start the Next.js app.
# CMD ["pnpm", "start"]
CMD ["npm", "start"]
