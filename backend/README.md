<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ pnpm install
```

## Langfuse reporting switch

Langfuse reporting is disabled by default. To enable trace, LangChain callback,
and score reporting, configure both Langfuse API keys, then set the following
environment variable and restart the backend:

```bash
LANGFUSE_TRACING_ENABLED=true
```

Set it to `false` (or remove it) to disable reporting again.

## Optional Bocha web search

The RAG agent can switch from the internal knowledge base to Bocha Web Search
when evidence assessment identifies a public or time-sensitive information gap.
Internal and web searches share the same maximum of three retrieval attempts.

```bash
BOCHA_API_KEY=your-api-key
# Optional defaults:
BOCHA_BASE_URL=https://api.bocha.cn
BOCHA_SEARCH_COUNT=5
BOCHA_MAX_RESULT_CHARS=4000
BOCHA_TIMEOUT_MS=8000
RAG_MAX_ITERATIONS=3
```

Without `BOCHA_API_KEY`, evidence assessment will not select web search.

## Shared chunks and optional OCR

Publishing a document now sends one `document.ingest` task. It performs the
shared chunk preparation once, stores the result in MongoDB's
`document_chunks`, and uses that same chunk set for the vector and knowledge
graph projections. OCR is disabled by default. To enable local OCR for Markdown
images, configure `tesseract.js`, which uses the Simplified Chinese model by
default:

```bash
OCR_ENABLED=true
# Optional: defaults shown below. Pre-download models and set OCR_LANG_PATH in
# production to avoid downloading them when the first image is indexed.
OCR_LANGUAGE=chi_sim
OCR_LANG_PATH=/opt/knowledge-hub/tessdata
OCR_CACHE_PATH=/var/cache/knowledge-hub/tesseract
OCR_MAX_IMAGE_BYTES=10485760
OCR_RECYCLE_AFTER_JOBS=500
```

OCR is processed by one reusable Worker at a time to bound memory consumption.
The Worker is recycled after the configured number of images.

VLM is intentionally not part of this pipeline.

## RBAC authorization cache

JWT only contains the user ID. Protected requests resolve the current authorization
snapshot through process memory (L1), Redis (L2), then PostgreSQL. Redis Pub/Sub
invalidates each instance's L1 cache after a role change.

```bash
# Defaults shown below
AUTHZ_CACHE_ENABLED=true
AUTHZ_L1_TTL_MS=60000
AUTHZ_L1_MAX_ENTRIES=100000
AUTHZ_L1_CLEANUP_INTERVAL_MS=60000
AUTHZ_L2_TTL_SECONDS=600
AUTHZ_CACHE_KEY_PREFIX=kh:authz:
AUTHZ_INVALIDATE_CHANNEL=kh:authz:invalidate
```

Call `UserService.invalidateAuthorization(userId)` after changing a user's role,
status, or authorization version. It deletes the L2 entry and broadcasts L1
invalidation to every running instance.

## Agent evaluation

See [docs/agent-evaluation-system.md](docs/agent-evaluation-system.md) for the
evaluation scorecard, dataset design, offline runner, SSE contract tests, online
monitoring, and rollout plan. The runnable dataset format is documented in
[evaluation/README.md](evaluation/README.md).

## Compile and run the project

```bash
# development
$ pnpm run start

# watch mode
$ pnpm run start:dev

# production mode
$ pnpm run start:prod
```

## Run tests

```bash
# unit tests
$ pnpm run test

# e2e tests
$ pnpm run test:e2e

# test coverage
$ pnpm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ pnpm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
