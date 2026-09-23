import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config.js';
import routes from './routes/index.js';

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      // Local Next.js (3000/3001) + configured origins + Chrome extensions
      if (
        /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
        origin.startsWith('chrome-extension://') ||
        config.corsOrigins.some(
          (o) => o === origin || o === '*' || (o.endsWith('*') && origin.startsWith(o.slice(0, -1))),
        )
      ) {
        return cb(null, true);
      }
      return cb(null, false);
    },
    credentials: true,
  }),
);
app.use(morgan('dev'));
app.use(express.json({ limit: '5mb' }));

app.use('/api', routes);

app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Not found' });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ success: false, error: err.message || 'Internal error' });
});

export default app;
