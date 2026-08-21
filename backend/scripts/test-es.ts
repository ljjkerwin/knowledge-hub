import 'dotenv/config'
import { Client } from '@elastic/elasticsearch';

console.log(process.env.ELASTICSEARCH_NODE)

const client = new Client({
      node: process.env.ELASTICSEARCH_NODE,
      auth: {
        username: 'elastic',
        password: process.env.ELASTICSEARCH_PASSWORD as string,
      },
});

async function main() {
  try {
    const response = await client.info();

    console.log('✅ Elasticsearch 连接成功');
    console.log('ES 版本:', response.version.number);
    console.log('集群名称:', response.name);
  } catch (error) {
    console.error('❌ Elasticsearch 连接失败');
    console.error(error);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main();