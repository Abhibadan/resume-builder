import { Module } from '@nestjs/common';
import { ClassicAtsTemplate } from './classic-ats.template.js';
import { ResumePdfRenderer } from './resume-pdf.renderer.js';
import { ResumeController } from './resume.controller.js';
import { ResumeService } from './resume.service.js';

@Module({
    controllers: [ResumeController],
    providers: [ResumeService, ClassicAtsTemplate, ResumePdfRenderer],
})
export class ResumeModule {}
