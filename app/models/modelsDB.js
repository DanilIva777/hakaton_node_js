const { Sequelize, DataTypes } = require("sequelize");
const { sequelize } = require("./client");

// Определение моделей
const Role = sequelize.define(
	"Role",
	{
		id: {
			type: DataTypes.INTEGER,
			primaryKey: true,
			autoIncrement: true,
		},
		naim: {
			type: DataTypes.TEXT,
			allowNull: false,
		},
	},
	{
		tableName: "role",
		schema: "public",
		timestamps: false,
	}
);

const Account = sequelize.define(
	"Account",
	{
		id: {
			type: DataTypes.INTEGER,
			primaryKey: true,
			autoIncrement: true,
		},
		login: {
			type: DataTypes.TEXT,
			allowNull: false,
			unique: true,
		},
		password: {
			type: DataTypes.TEXT,
			allowNull: false,
		},
		role_id: {
			type: DataTypes.INTEGER,
			allowNull: false,
		},
		token: {
			type: DataTypes.TEXT,
			allowNull: false,
			unique: true,
		},
	},
	{
		tableName: "account",
		schema: "public",
		timestamps: false,
	}
);

// Определение модели SettingTicket
const SettingTicket = sequelize.define(
	"SettingTicket",
	{
		id: {
			type: DataTypes.INTEGER,
			primaryKey: true,
			autoIncrement: true,
		},
		time: {
			type: DataTypes.DATE,
			allowNull: true,
		},
		fond: {
			type: DataTypes.DECIMAL,
			allowNull: true,
		},
		percent_fond: {
			type: DataTypes.DECIMAL,
			allowNull: true,
		},
		is_start: {
			type: DataTypes.BOOLEAN,
			allowNull: true,
		},
		size_x: {
			type: DataTypes.INTEGER,
			allowNull: true,
		},
		size_y: {
			type: DataTypes.INTEGER,
			allowNull: true,
		},
		count_number_row: {
			type: DataTypes.ARRAY(DataTypes.INTEGER),
			allowNull: true,
		},
		count_fill_user: {
			type: DataTypes.INTEGER,
			allowNull: true,
		},
	},
	{
		tableName: "setting_ticket",
		schema: "public",
		timestamps: false,
	}
);

// Определение модели GeneratedTicket
const GeneratedTicket = sequelize.define(
	"GeneratedTicket",
	{
		id: {
			type: DataTypes.INTEGER,
			primaryKey: true,
			autoIncrement: true,
		},
		id_setting_ticket: {
			type: DataTypes.INTEGER,
			allowNull: false,
		},
		date_generated: {
			type: DataTypes.DATEONLY,
			allowNull: true,
		},
		time_generated: {
			type: DataTypes.DATE,
			allowNull: true,
		},
		arr_number: {
			type: DataTypes.JSONB,
			allowNull: true,
		},
	},
	{
		tableName: "generated_ticket",
		schema: "public",
		timestamps: false,
	}
);

// Определение модели FilledTicket
const FilledTicket = sequelize.define(
	"FilledTicket",
	{
		id: {
			type: DataTypes.INTEGER,
			primaryKey: true,
			autoIncrement: true,
		},
		id_user: {
			type: DataTypes.INTEGER,
			allowNull: false,
		},
		date: {
			type: DataTypes.DATEONLY,
			allowNull: true,
		},
		time: {
			type: DataTypes.DATE,
			allowNull: true,
		},
		filled_cell: {
			type: DataTypes.JSONB,
			allowNull: true,
		},
		is_win: {
			type: DataTypes.BOOLEAN,
			allowNull: true,
		},
		prize: {
			type: DataTypes.DECIMAL,
			allowNull: true,
		},
		id_ticket: {
			type: DataTypes.INTEGER,
			allowNull: false,
		},
	},
	{
		tableName: "filled_ticket",
		schema: "public",
		timestamps: false,
	}
);

// Определение связей
// Связь account -> role (многие к одному)
Role.hasMany(Account, { foreignKey: "role_id", as: "accounts" });
Account.belongsTo(Role, { foreignKey: "role_id", as: "role" });

// Связь generated_ticket -> setting_ticket (многие к одному)
SettingTicket.hasMany(GeneratedTicket, {
	foreignKey: "id_setting_ticket",
	as: "generated_tickets",
});
GeneratedTicket.belongsTo(SettingTicket, {
	foreignKey: "id_setting_ticket",
	as: "setting_ticket",
});

// Связь filled_ticket -> account (многие к одному)
Account.hasMany(FilledTicket, { foreignKey: "id_user", as: "filled_tickets" });
FilledTicket.belongsTo(Account, { foreignKey: "id_user", as: "user" });

// Связь filled_ticket -> generated_ticket (многие к одному)
GeneratedTicket.hasMany(FilledTicket, {
	foreignKey: "id_ticket",
	as: "filled_tickets",
});
FilledTicket.belongsTo(GeneratedTicket, {
	foreignKey: "id_ticket",
	as: "ticket",
});

// Экспорт моделей
module.exports = {
	Role,
	Account,
	SettingTicket,
	GeneratedTicket,
	FilledTicket,
};
