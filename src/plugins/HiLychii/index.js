const Plugin = require('../../libs/Plugin')

class HiJelly extends Plugin {
  constructor(bot) {
    super(bot)
  }

  init() {
    this.register(/^(hi|hello)/i, {
      handler: (metaMsg, matches) => {
        this.client.reply(`Hello!`, metaMsg)
      }
    })
  }
}

module.exports = HiJelly
