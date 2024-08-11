import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected conversationsTableName = 'conversations'
  protected conversationItemsTableName = 'conversation_items'

  async up() {
    this.schema.createTable(this.conversationsTableName, (table) => {
      table.string('id')

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.primary(['id'])
    })

    this.schema.createTable(this.conversationItemsTableName, (table) => {
      table.string('conversation_id')
      table.integer('order')
      table.string('text')
      table.enum('author', ['agent', 'user'], {
        enumName: 'conversation_item_author',
        useNative: true,
      })

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.conversationItemsTableName)
    this.schema.dropTable(this.conversationsTableName)
  }
}
