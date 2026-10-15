import { DONT_INITIATE_PRISMA_CLIENT as PrismaClient } from '@reelmakeeasy/api-db'
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'

// default prisma service for mongoDB
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy, OnModuleInit {
  async onModuleDestroy() {
    await this.$disconnect()
  }

  async onModuleInit() {
    await this.$connect()
  }
}
