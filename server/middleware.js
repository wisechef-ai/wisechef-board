import cors from 'cors';
import express from 'express';
import path from 'path';
import { __dirname } from './config.js';

export function setupMiddleware(app) {
  app.use(cors());
  app.use(express.json());
  // Serve static assets but NOT index.html (let routes.js handle / with onboarding gate)
  app.use(express.static(path.join(__dirname, 'dist'), { index: false }));
}
