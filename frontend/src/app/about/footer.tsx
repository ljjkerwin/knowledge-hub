import { cacheLife } from 'next/cache';

export default async function Footer() {
  'use cache';

  cacheLife({
    stale: 0,
    revalidate: 10,
    expire: 11,
  });

  console.error('render footer');
  return <div>...</div>;
}
