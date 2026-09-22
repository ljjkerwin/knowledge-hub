import { Suspense } from 'react';
import { cacheLife } from 'next/cache';
import { Info } from 'lucide-react';
import type { AboutInfo, ApiResponse } from '@/types/api.types';
import Footer from './footer';


const backendUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5002')
  .replace(/\/$/, '')
  .replace(/\/api$/, '');

async function getAbout(): Promise<AboutInfo> {
  // const cookieStore = await cookies(); // 有这句话，或者获取headers，就会避免build时候获取接口数据ssg

  const response = await fetch(`${backendUrl}/api/about`);

  if (!response.ok) {
    throw new Error('无法加载介绍内容');
  }

  const result = (await response.json()) as ApiResponse<AboutInfo> | AboutInfo;
  return 'data' in result ? result.data : result;
}

async function AboutContent() {
  'use cache';

  cacheLife({
    stale: 0,
    revalidate: 5,
    expire: 11,
  });

  const about = await getAbout();
  console.error('render page');
  return (
    <>
      <div className="mb-6 flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Info className="size-6" />
      </div>
      <h1 className="text-3xl font-semibold tracking-tight">{about.title}</h1>
      <p className="mt-4 text-base leading-7 text-muted-foreground">{about.description}</p>
      <ul className="mt-6 space-y-3">
        {about.highlights.map((highlight) => (
          <li key={highlight} className="flex gap-3 text-sm leading-6">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
            <span>{highlight}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function AboutContentLoading() {
  return <div className="text-muted-foreground">正在加载介绍内容…</div>;
}

export default function AboutPage() {
  return (
    <div className="flex h-full flex-1 items-center justify-center overflow-auto p-6">
      <section className="w-full max-w-2xl rounded-2xl border bg-card p-8 shadow-sm">
        <Suspense fallback={<AboutContentLoading />}>
          <AboutContent />
        </Suspense>
        <Suspense fallback={null}>
          <Footer />
        </Suspense>
      </section>
    </div>
  );
}
