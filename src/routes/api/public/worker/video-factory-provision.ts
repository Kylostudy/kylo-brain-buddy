import { createFileRoute } from '@tanstack/react-router';
import { provisionFactory } from '@/lib/video-factory-provision';

export const Route = createFileRoute('/api/public/worker/video-factory-provision')({
  server: { handlers: {
    POST: ({ request }) => provisionFactory(request,
      process.env.WORKER_API_TOKEN_V2 || process.env.WORKER_API_TOKEN,
      process.env.KYLOGIC_VIDEO_FACTORY_SECRET),
  } },
});