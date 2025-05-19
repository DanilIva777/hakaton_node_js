const { Sequelize, DataTypes } = require("sequelize");
const { sequelize } = require("./client");

// Определение модели Role
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

// Определение модели Account
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
		mail: {
			type: DataTypes.TEXT,
			allowNull: true,
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
		price_ticket: {
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
		price: {
			type: DataTypes.DECIMAL,
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
		arr_true_number: {
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
		id_ticket: {
			type: DataTypes.INTEGER,
			allowNull: false,
		},
		id_history_operation: {
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

// Определение модели HistoryOperation
const HistoryOperation = sequelize.define(
	"HistoryOperation",
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
		change: {
			type: DataTypes.DECIMAL,
			allowNull: false,
		},
		type_transaction: {
			type: DataTypes.INTEGER,
			allowNull: false,
		},
		is_succesfull: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: false,
		},
	},
	{
		tableName: "history_operation",
		schema: "public",
		timestamps: false,
	}
);

// Определение модели TypeTransaction
const TypeTransaction = sequelize.define(
	"TypeTransaction",
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
		tableName: "type_transaction",
		schema: "public",
		timestamps: false,
	}
);

// Определение модели UserInfo
const UserInfo = sequelize.define(
	"UserInfo",
	{
		id: {
			type: DataTypes.INTEGER,
			primaryKey: true,
			autoIncrement: true,
		},
		id_acc: {
			type: DataTypes.INTEGER,
			allowNull: false,
		},
		balance_virtual: {
			type: DataTypes.DECIMAL,
			allowNull: false,
		},
		balance_real: {
			type: DataTypes.DECIMAL,
			allowNull: false,
		},
	},
	{
		tableName: "user_info",
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

// Связь filled_ticket -> user_info (многие к одному)
UserInfo.hasMany(FilledTicket, { foreignKey: "id_user", as: "filled_tickets" });
FilledTicket.belongsTo(UserInfo, { foreignKey: "id_user", as: "user" });

// Связь filled_ticket -> generated_ticket (многие к одному)
GeneratedTicket.hasMany(FilledTicket, {
	foreignKey: "id_ticket",
	as: "filled_tickets",
});
FilledTicket.belongsTo(GeneratedTicket, {
	foreignKey: "id_ticket",
	as: "ticket",
});

// Связь filled_ticket -> history_operation (многие к одному)
HistoryOperation.hasMany(FilledTicket, {
	foreignKey: "id_history_operation",
	as: "filled_tickets",
});
FilledTicket.belongsTo(HistoryOperation, {
	foreignKey: "id_history_operation",
	as: "history",
});

// Связь history_operation -> user_info (многие к одному)
UserInfo.hasMany(HistoryOperation, {
	foreignKey: "id_user",
	as: "history_operations",
});
HistoryOperation.belongsTo(UserInfo, { foreignKey: "id_user", as: "user" });

// Связь history_operation -> type_transaction (многие к одному)
TypeTransaction.hasMany(HistoryOperation, {
	foreignKey: "type_transaction",
	as: "history_operations",
});
HistoryOperation.belongsTo(TypeTransaction, {
	foreignKey: "type_transaction",
	as: "transaction_type",
});

// Связь user_info -> account (многие к одному)
Account.hasOne(UserInfo, { foreignKey: "id_acc", as: "info" });
UserInfo.belongsTo(Account, { foreignKey: "id_acc", as: "account" });

// Экспорт моделей
module.exports = {
	sequelize,
	Role,
	Account,
	SettingTicket,
	GeneratedTicket,
	FilledTicket,
	HistoryOperation,
	TypeTransaction,
	UserInfo,
};
