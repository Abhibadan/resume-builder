import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { resumeBodyParser } from './resumes/resume-body-parser.js';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    app.use('/resumes/render', resumeBodyParser);
    app.enableShutdownHooks();
    await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
