import { createFileRoute } from '@tanstack/react-router';
import { provisionFactory } from '@/lib/video-factory-provision';

export const Route = createFileRoute('/api/public/worker/video-factory-provision')({
  server: { handlers: {
    POST: ({ request }) => provisionFactory(request,
      process.env.WORKER_API_TOKEN_V2 || process.env.WORKER_API_TOKEN,
      process.env.KYLOGIC_VIDEO_FACTORY_SECRET, async () => {
        const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
        const { data, error } = await supabaseAdmin.from('worker_deploy_requests')
          .select('id').eq('worker_id', 'worker-1').eq('status', 'running')
          .gte('started_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
          .limit(1).maybeSingle();
        return !error && Boolean(data);
      }),
  } },
});