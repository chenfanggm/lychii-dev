require('./libs/normalize')
const fs = require('fs')
const path = require('path')
const util = require('util')
const mongoose = require('mongoose')
const SlackAdapter = require('./slack/SlackAdapter')
const config = require('./config')
const debug = require('debug')('app:bot')

// ----------------------------------
// Lychii Bot
// ----------------------------------
class LychiiBot {

  constructor() {
    this.client = null
    this.self = null
    this.team = null
    this.users = null
    this.defaultChannel = null
    this.plugins = []
    this.onAuthenticated = this.onAuthenticated.bind(this)
    this.onConnected = this.onConnected.bind(this)
    this.onIncomingMessage = this.onIncomingMessage.bind(this)
    this.onReactionAdded = this.onReactionAdded.bind(this)
    this.onDisconnected = this.onDisconnected.bind(this)
    this.registerPlugin = this.registerPlugin.bind(this)
  }

  init() {
    // init storage: [mongodb]
    if (config.storage && config.storage.mongo.enable) {
      debug('init mongoose...')
      mongoose.Promise = Promise
      mongoose.connect(config.storage.mongo.uri, {
        useMongoClient: true,
        keepAlive: 1
      })
      mongoose.connection.on('error', () => {
        throw new Error('Failed to connect to database:' + config.storage.mongo.uri)
      })
      mongoose.connection.once('open', () => {
        debug('mongodb connected')
      })
      if (config.env === 'development') {
        mongoose.set('debug', (collectionName, method, query, doc) => {
          debug(collectionName + '.' + method, util.inspect(query, false, 20), doc)
        })
      }
    }

    // init client adapter
    this.client = new SlackAdapter({
      token: config.token
    })

    // init event handler
    this.client.on(SlackAdapter.EVENTS.AUTHENTICATED, this.onAuthenticated)
    this.client.on(SlackAdapter.EVENTS.CONNECTED, this.onConnected)
    this.client.on(SlackAdapter.EVENTS.MESSAGE, this.onIncomingMessage)
    this.client.on(SlackAdapter.EVENTS.REACTION_ADDED, this.onReactionAdded)
    this.client.on(SlackAdapter.EVENTS.DISCONNECTED, this.onDisconnected)

    // init plugins
    this.loadPlugins()

    // go!
    this.client.start()
  }

  loadPlugins() {
    const plugins = require('./plugins')
    if (plugins) {
      plugins.map((plugin) => {
        this.registerPlugin(plugin)
      })
    } else {
      const pluginsDirPath = path.resolve(__dirname, './plugins')
      fs.readdir(pluginsDirPath, (err, files) => {
        if (err) throw err
        if (files) {
          files.map((file) => {
            const pluginFilePath = path.resolve(pluginsDirPath, file)
            if (fs.lstatSync(pluginFilePath).isDirectory()) {
              const plugin = require(pluginFilePath)
              if (plugin) {
                this.registerPlugin(plugin)
              }
            }
          })
        }
      })
    }
  }

  registerPlugin(plugin) {
    debug(`register plugin: ${plugin.name}`)

    const pluginInstance = new plugin(this)
    this.plugins.push(pluginInstance)

    if (pluginInstance.init && typeof pluginInstance.init === 'function') {
      pluginInstance.init()
    }
  }

  onAuthenticated(identity) {
    this.self = identity.self
    this.team = identity.team
    this.users = identity.users

    // get bot_id
    for (let i = 0; i < this.users.length; i++) {
      if (this.users[i].id === this.self.id) {
        this.self.botId = this.users[i].profile.bot_id
      }
    }

    // default channel for post bot status
    for (const group of identity.groups) {
      if (group.name === config.defaultChannel) {
        this.defaultChannel = group
      }
    }

    debug(`login to team ${this.team.name} as ${this.self.name}`)
    debug(`default channel: ${this.defaultChannel.name}`)
  }

  onConnected() {
    const user = this.client.rtm.dataStore
      .getUserById(this.client.rtm.activeUserId)
    const team = this.client.rtm.dataStore
      .getTeamById(this.client.rtm.activeTeamId)
    debug(`connected to team ${team.name} as ${user.name}`)

    this.client.send(`Hello! I'm ${this.self.name}`, this.defaultChannel)
  }

  onDisconnected() {
    if (config.autoReconnect) {
      //TODO: add reconnect handler
      debug('disconnected, waiting for reconnect')
    } else {
      debug('disconnected, terminating bot...')
      this.client.disconnect()
      process.exit(1)
    }
  }

  onIncomingMessage(metaMsg) {
    // filter accepted message
    const selfRecognizeRegex = new RegExp(`^(@?${this.self.name}\\s)`, 'i')
    if(!this.isAcceptable(metaMsg, selfRecognizeRegex)) return
    this.trimMessage(metaMsg, selfRecognizeRegex)

    let { text, user, bot, channel, subtype, topic } = metaMsg

    // optimize meta
    user = user || bot || {}
    subtype = subtype || 'message'

    // process message
    switch (subtype) {
      case 'channel_join':
      case 'group_join':
        debug(`${user.name} has joined ${channel.name}`)
        break
      case 'channel_leave':
      case 'group_leave':
        debug(`${user.name} has left ${channel.name}`)
        break
      case 'channel_topic':
      case 'group_topic':
        debug(`${user.name} set the topic in ${channel.name} to ${topic}`)
        break
      case 'message':
      case 'bot_message':
      default:
        debug(`received from ${user.name} in channel ${channel.name}: ${text}`)
        this.processMessage(metaMsg)
        break
    }
  }

  isAcceptable(metaMsg, selfRecognizeRegex) {
    let { text, user, bot } = metaMsg
    // ignore that sent from self
    if (user && user.id === this.self.id) return false
    if (bot && bot.id === this.self.botId) return false

    // accept direct message
    if (metaMsg.isDM) {
      return true
    }
    // ignore that not mention self
    return selfRecognizeRegex.test(text);

  }

  trimMessage(metaMsg, selfRecognizeRegex) {
    metaMsg.text = metaMsg.text.trim()
    // clean self annotation
    metaMsg.text = metaMsg.text.replace(selfRecognizeRegex, '')
  }

  processMessage(metaMsg) {
    debug(`processing: ${metaMsg.text}`)
    this.plugins.map((plugin) => {
      plugin.processMessage(metaMsg)
    })
  }

  onReactionAdded(reaction) {
    debug('reaction added: ', reaction)
  }

}

module.exports = LychiiBot


