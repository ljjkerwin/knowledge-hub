import { redirect } from 'next/navigation';

// 首页只负责服务端跳转，不产生可预渲染的页面壳。
export const instant = false;

export default function Home() {
  redirect('/chat');
}
