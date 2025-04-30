const { Client, IntentsBitField, Collection, EmbedBuilder, Colors } = require('discord.js');
const fs = require('fs');
const path = require('path');
const client = require('./client');
const { BOT_TOKEN } = require('./config');
const { loadCommands } = require('./commandLoader');
const { handleInteractionCreate } = require('./utils/interactionHandler');
const { getServerSettings } = require('./utils/guildSettings');
const { takeActionAgainstBot, handleExternalMessage } = require('./utils/externalMessageHandler');
const { handleError, handleCriticalError } = require('./utils/errorHandler');
const slowmodeCommand = require('./commands/slowmode');

client.commands = new Collection();

function loadSkidders(guildId) {
    const filePath = path.join(__dirname, `skiders.json`);
    try {
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        }
        return {};
    } catch (error) {
        console.error(`Lỗi khi đọc file skiders.json: ${error.message}`);
        return {};
    }
}

client.once('ready', async () => {
    try {
        console.info(`🤖 Bot đã sẵn sàng! ${client.user.tag} - Guilds: ${client.guilds.cache.size}`);
        await initializeBot();
        setInterval(setBotPresence, 600000);
    } catch (error) {
        console.error(`❌ Bot khởi động lỗi: ${error.message}`);
    }
});

async function initializeBot() {
    await loadCommandsFromDir();
    await Promise.all([
        setBotPresence(),
        registerCommands(),
    ]);
}

async function loadCommandsFromDir() {
    const commandFiles = fs.readdirSync(path.join(__dirname, 'commands'))
        .filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
        try {
            const command = require(path.join(__dirname, 'commands', file));
            if (command && typeof command === 'object' && command.name && command.execute) {
                client.commands.set(command.name, command);
                console.info(`Đã tải lệnh: ${command.name}`);
            } else {
                console.warn(`Tệp ${file} không xuất khẩu lệnh hợp lệ (thiếu 'name' hoặc 'execute')`);
            }
        } catch (error) {
            console.error(`Lỗi khi tải lệnh từ tệp ${file}: ${error.message}`);
        }
    }
}

async function registerCommands() {
    try {
        const commandHandlers = await loadCommands();
        const commandData = Array.from(client.commands.values()).map(cmd => ({
            name: cmd.name,
            description: cmd.description || 'Không có mô tả',
            options: cmd.options || [],
        }));

        await client.application.commands.set(commandData);
        console.info(`✅ Đã đăng ký ${commandData.length} lệnh: ${commandData.map(cmd => cmd.name).join(', ')}`);
    } catch (err) {
        console.error(`❌ Lỗi đăng ký lệnh: ${err.message}`);
    }
}

async function setBotPresence() {
    const statuses = [
        { name: '/help', type: 1 },
        () => ({ name: `mchbee.cloud ${client.guilds.cache.size}`, type: 1 }),
        { name: 'https://mchbee.cloud', type: 1 }
    ];

    let index = 0;

    async function updateStatus() {
        try {
            const status = typeof statuses[index] === 'function' ? statuses[index]() : statuses[index];
            await client.user.setPresence({ activities: [status], status: 'idle' });
            index = (index + 1) % statuses.length;
        } catch (err) {
            console.error(`❌ Cập nhật trạng thái lỗi: ${err.message}`);
        }
    }

    updateStatus();
    setInterval(updateStatus, 120000);
}

async function getOrCreateSkidderRole(guild) {
    let skidderRole = guild.roles.cache.find(role => role.name.toLowerCase() === 'skidder');
    if (!skidderRole) {
        try {
            skidderRole = await guild.roles.create({
                name: 'Skidder',
                color: '#FFFF00',
                reason: 'Tự động tạo role Skidder bởi bot'
            });
            console.info(`Đã tạo role Skidder trong guild ${guild.id}`);
        } catch (error) {
            console.error(`Lỗi khi tạo role Skidder trong guild ${guild.id}: ${error.message}`);
        }
    }
    return skidderRole;
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    try {
        if (!message.guild) {
            await handleExternalMessage(message);
            return;
        }

        const guild = message.guild;
        const guildId = guild.id;
        
        const skidders = loadSkidders(guildId);
        const isInJson = skidders[message.author.id];

        const skidderRole = await getOrCreateSkidderRole(guild);
        const member = await guild.members.fetch(message.author.id);
        const hasSkidderRole = skidderRole && member.roles.cache.has(skidderRole.id);

        if (isInJson || hasSkidderRole) {
            const icons = ['😂', '🤓', '😈', '🤡', '💀', '👾', '🎭', '👻', '🤖', '👽', '😹', '🙀', '🤤', '🥳', '🤯', '😜'];
            const randomIcon = icons[Math.floor(Math.random() * icons.length)];
            await message.reply({
                content: `${randomIcon} **Trung bình Skidder** ${randomIcon}`,
                files: ['https://i.imgur.com/ZbDUIA2.png'],
                allowedMentions: { users: [message.author.id] }
            });
        }
    } catch (error) {
        console.error(`Lỗi trong sự kiện messageCreate từ ${message.author.tag} (ID: ${message.author.id}): ${error.message}`);
    }
});

client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) {
                console.error(`❌ Lệnh không tồn tại: ${interaction.commandName}`);
                await interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(Colors.Red)
                            .setTitle('❌ Lệnh Không Tồn Tại')
                            .setDescription(`Không tìm thấy lệnh \`${interaction.commandName}\`.`)
                            .setTimestamp()
                    ],
                    ephemeral: true,
                    allowedMentions: { users: [interaction.user.id] }
                });
                return;
            }
            await command.execute(interaction);
            return;
        }

        if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'slowmode_select') {
                return slowmodeCommand.handleInteraction(interaction);
            }
        }
    } catch (err) {
        console.error(`❌ Xử lý tương tác lỗi: ${err.message}`);
        if (interaction.isCommand() || interaction.isStringSelectMenu()) {
            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(Colors.Red)
                        .setTitle('❌ Lỗi')
                        .setDescription('Đã xảy ra lỗi khi thực hiện hành động.')
                        .setTimestamp()
                ],
                ephemeral: true,
                allowedMentions: { users: [interaction.user.id] }
            }).catch(() => {});
        }
    }
});

client.on('guildMemberAdd', async (member) => {
    const guildId = member.guild.id;
    const skidders = loadSkidders(guildId);
    const skidderRole = await getOrCreateSkidderRole(member.guild);

    if (skidders[member.id] && skidderRole) {
        await member.roles.add(skidderRole).catch(err => {
            console.error(`Lỗi thêm role Skidder khi ${member.user.tag} rejoin: ${err.message}`);
        });
        console.info(`Đã thêm role Skidder cho ${member.user.tag} khi rejoin guild ${guildId}`);
    }
});

process.on('uncaughtException', async (err) => {
    handleCriticalError(err);
    console.error(`❌ Uncaught Exception: ${err.message}`);
});

process.on('unhandledRejection', async (reason) => {
    console.warn(`⚠️ Unhandled Rejection: ${reason}`);
    handleError(reason);
});

process.on('SIGINT', async () => {
    console.info('🔴 Bot đang tắt...');
    process.exit(0);
});

client.login(BOT_TOKEN).then(() => {
    console.info('✅ Bot đã đăng nhập thành công.');
}).catch(async (err) => {
    console.error(`❌ Đăng nhập lỗi: ${err.message}`);
});
