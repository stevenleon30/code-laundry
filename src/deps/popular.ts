/**
 * Widely used npm packages. Used as the reference set for typosquat detection and to
 * skip the (expensive) publish-age lookup for packages that are obviously established.
 * Hand-curated; not exhaustive.
 */
export const POPULAR_PACKAGES: readonly string[] = [
  // frameworks & servers
  "react", "react-dom", "next", "vue", "nuxt", "svelte", "@sveltejs/kit", "angular", "@angular/core", "@angular/common",
  "express", "koa", "fastify", "hono", "hapi", "@hapi/hapi", "@nestjs/core", "@nestjs/common", "restify", "polka",
  "remix", "@remix-run/node", "astro", "solid-js", "preact", "lit", "ember-source", "gatsby", "electron",
  // http & networking
  "axios", "node-fetch", "got", "superagent", "request", "undici", "ky", "cross-fetch", "isomorphic-fetch", "ws",
  "socket.io", "socket.io-client", "http-proxy", "http-proxy-middleware", "cors", "helmet", "body-parser", "cookie-parser",
  "express-session", "multer", "morgan", "compression", "express-rate-limit", "express-validator", "passport", "passport-jwt",
  "passport-local", "jsonwebtoken", "jose", "bcrypt", "bcryptjs", "argon2", "csurf",
  // data & validation
  "zod", "yup", "joi", "ajv", "class-validator", "class-transformer", "valibot", "superstruct", "io-ts",
  // utils
  "lodash", "lodash-es", "underscore", "ramda", "immer", "immutable", "uuid", "nanoid", "date-fns", "dayjs", "moment",
  "luxon", "chalk", "commander", "yargs", "inquirer", "ora", "debug", "dotenv", "cross-env", "rimraf", "glob", "fast-glob",
  "minimatch", "micromatch", "chokidar", "fs-extra", "graceful-fs", "mkdirp", "semver", "qs", "query-string", "classnames",
  "clsx", "tailwind-merge", "deepmerge", "fast-deep-equal", "rxjs", "eventemitter3", "p-limit", "p-queue", "async",
  "bluebird", "colors", "kleur", "picocolors", "minimist", "cac", "execa", "shelljs", "cheerio", "jsdom", "marked",
  "markdown-it", "highlight.js", "prismjs", "handlebars", "ejs", "pug", "mustache", "nunjucks", "sharp", "jimp", "pdfkit",
  "xml2js", "fast-xml-parser", "papaparse", "csv-parse", "yaml", "js-yaml", "toml", "ini", "json5", "mime", "mime-types",
  "validator", "slugify", "pluralize", "numeral", "big.js", "decimal.js", "bignumber.js", "crypto-js", "node-forge",
  "tweetnacl", "pako", "jszip", "archiver", "tar", "form-data", "formidable", "busboy", "nodemailer", "twilio", "stripe",
  "openai", "@anthropic-ai/sdk", "langchain", "@langchain/core", "ai", "cron", "node-cron", "bull", "bullmq", "agenda",
  "winston", "pino", "bunyan", "log4js", "signale", "lru-cache", "node-cache", "keyv", "cookie", "js-cookie", "ms",
  "pretty-bytes", "fast-json-stringify", "superjson", "serialize-javascript", "reflect-metadata", "tslib", "core-js",
  "regenerator-runtime", "@babel/core", "@babel/runtime", "zustand", "redux", "@reduxjs/toolkit", "react-redux", "mobx",
  "jotai", "recoil", "swr", "@tanstack/react-query", "react-router", "react-router-dom", "react-hook-form", "formik",
  "styled-components", "@emotion/react", "@emotion/styled", "tailwindcss", "postcss", "autoprefixer", "sass", "less",
  "framer-motion", "@mui/material", "antd", "@chakra-ui/react", "@radix-ui/react-dialog", "lucide-react", "react-icons",
  "chart.js", "d3", "recharts", "three", "leaflet", "mapbox-gl", "socket.io-redis", "i18next", "react-i18next",
  // data stores & ORMs
  "pg", "mysql", "mysql2", "sqlite3", "better-sqlite3", "mongodb", "mongoose", "redis", "ioredis", "prisma",
  "@prisma/client", "typeorm", "sequelize", "knex", "drizzle-orm", "kysely", "objection", "@supabase/supabase-js",
  "firebase", "firebase-admin", "@aws-sdk/client-s3", "@aws-sdk/client-dynamodb", "aws-sdk", "@google-cloud/storage",
  "@azure/storage-blob", "elasticsearch", "@elastic/elasticsearch", "cassandra-driver", "neo4j-driver", "kafkajs",
  "amqplib", "graphql", "apollo-server", "@apollo/server", "@apollo/client", "graphql-tag", "type-graphql", "@trpc/server",
  // tooling & testing
  "typescript", "ts-node", "tsx", "esbuild", "vite", "webpack", "rollup", "parcel", "babel-loader", "eslint", "prettier",
  "jest", "vitest", "mocha", "chai", "sinon", "supertest", "nock", "msw", "playwright", "@playwright/test", "puppeteer",
  "cypress", "@testing-library/react", "@testing-library/jest-dom", "nodemon", "concurrently", "husky", "lint-staged",
  "@types/node", "@types/react", "@types/express", "@modelcontextprotocol/sdk",
];

export const POPULAR_SET: ReadonlySet<string> = new Set(POPULAR_PACKAGES);
