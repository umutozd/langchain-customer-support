import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class ConversationItem extends BaseModel {
  @column({ isPrimary: true })
  declare conversationId: string

  @column({ isPrimary: true })
  declare order: number

  @column()
  declare text: string

  @column()
  declare author: 'agent' | 'user'

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
