import { INestApplication } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'

export function getSwaggerEnabled(): boolean {
  return process.env['API_ENABLE_SWAGGER'] === 'true'
}

export function setupSwagger(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('ReelMakeEasy API')
    .setDescription('API Specification for ReelMakeEasy')
    .setVersion('beta')
    .addTag('reelmakeeasy')
    .build()
  const documentFactory = () => SwaggerModule.createDocument(app, config)
  SwaggerModule.setup('openapi', app, documentFactory, {
    swaggerOptions: {
      apisSorter: 'alpha',
      operationsSorter: 'alpha',
      tagsSorter: 'alpha',
      docExpansion: 'none',
    },
  })
}
