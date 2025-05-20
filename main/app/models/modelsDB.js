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
			unique: true, // Добавлено для согласованности с базой данных
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
			unique: true, // Добавлено для согласованности с базой данных
		},
		mail: {
			type: DataTypes.TEXT,
			allowNull: true,
			unique: true, // Добавлено для согласованности с базой данных
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
			type: DataTypes.TIME,
			allowNull: true,
		},
		price_ticket: {
			type: DataTypes.DECIMAL(10, 2), // Уточнён тип для согласованности
			allowNull: true,
		},
		percent_fond: {
			type: DataTypes.DECIMAL(5, 2), // Уточнён тип для процентов
			allowNull: true,
		},
		is_start: {
			type: DataTypes.BOOLEAN,
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
		arr_number: {
			type: DataTypes.ARRAY(DataTypes.INTEGER),
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
			type: DataTypes.TIME,
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
			type: DataTypes.TIME,
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
		multiplier: {
			type: DataTypes.DECIMAL(10, 2),
			allowNull: true,
		},
		multiplier_numbers: {
			type: DataTypes.JSONB,
			allowNull: true,
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
			type: DataTypes.DECIMAL(10, 2), // Изменено с money на DECIMAL
			allowNull: false,
		},
		type_transaction: {
			type: DataTypes.INTEGER,
			allowNull: false,
		},
		is_succesfull: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: false, // Добавлено для согласованности
		},
		date: {
			type: DataTypes.DATEONLY,
			allowNull: true,
		},
		time: {
			type: DataTypes.TIME,
			allowNull: true,
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
			type: DataTypes.DECIMAL(10, 2), // Изменено с money на DECIMAL
			allowNull: false,
		},
		balance_real: {
			type: DataTypes.DECIMAL(10, 2), // Изменено с money на DECIMAL
			allowNull: false,
		},
		is_vip: {
			type: DataTypes.BOOLEAN,
			allowNull: true,
			defaultValue: false, // Добавлено для согласованности
		},
		vip_stop_date: {
			type: DataTypes.DATEONLY,
			allowNull: true,
		},
		category_vip: {
			// Добавлено поле, отсутствующее в исходной модели
			type: DataTypes.INTEGER,
			allowNull: true,
		},
	},
	{
		tableName: "user_info",
		schema: "public",
		timestamps: false,
	}
);

// Определение модели VipCost
const VipCost = sequelize.define(
	"VipCost",
	{
		id: {
			type: DataTypes.INTEGER,
			primaryKey: true,
			autoIncrement: true,
		},
		naim: {
			type: DataTypes.TEXT,
			allowNull: true,
		},
		price: {
			type: DataTypes.DECIMAL(10, 2),
			allowNull: false,
			validate: {
				min: 0,
			},
		},
		count_day: {
			type: DataTypes.INTEGER,
			allowNull: false,
			validate: {
				min: 1,
			},
		},
		category: {
			// Добавлено поле, отсутствующее в исходной модели
			type: DataTypes.INTEGER,
			allowNull: true,
		},
	},
	{
		tableName: "vip_cost",
		schema: "public",
		timestamps: false,
	}
);

const Game = sequelize.define(
	"Game",
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
		grid: {
			type: DataTypes.JSONB,
			allowNull: false,
		},
		current_number: {
			type: DataTypes.INTEGER,
			allowNull: true,
		},
		skip_count: {
			type: DataTypes.INTEGER,
			allowNull: false,
			defaultValue: 0,
		},
		current_move_cost: {
			type: DataTypes.DECIMAL(10, 2),
			allowNull: false,
			defaultValue: 5.0,
		},
		total_bets: {
			type: DataTypes.DECIMAL(10, 2),
			allowNull: false,
			defaultValue: 0.0,
		},
		total_payouts: {
			type: DataTypes.DECIMAL(10, 2),
			allowNull: false,
			defaultValue: 0.0,
		},
		is_active: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: true,
		},
		date_created: {
			type: DataTypes.DATEONLY,
			allowNull: true,
		},
		time_created: {
			type: DataTypes.TIME,
			allowNull: true,
		},
	},
	{
		tableName: "game",
		schema: "public",
		timestamps: false,
	}
);

const SettingGame = sequelize.define(
	"SettingGame",
	{
		id: {
			type: DataTypes.INTEGER,
			primaryKey: true,
			autoIncrement: true,
		},
		base_move_cost: {
			type: DataTypes.DECIMAL(10, 2),
			allowNull: false,
			defaultValue: 5.0,
		},
		initial_skill_cost: {
			type: DataTypes.DECIMAL(10, 2),
			allowNull: false,
			defaultValue: 3.0,
		},
		payout_row_col: {
			type: DataTypes.DECIMAL(10, 2),
			allowNull: false,
			defaultValue: 15.0,
		},
		payout_block: {
			type: DataTypes.DECIMAL(10, 2),
			allowNull: false,
			defaultValue: 50.0,
		},
		payout_complete: {
			type: DataTypes.DECIMAL(10, 2),
			allowNull: false,
			defaultValue: 500.0,
		},
		initial_filled_cells: {
			type: DataTypes.INTEGER,
			allowNull: false,
			defaultValue: 40,
		},
		is_active: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: true,
		},
	},
	{
		tableName: "setting_game",
		schema: "public",
		timestamps: false,
	}
);

// Определение связей
UserInfo.hasMany(Game, { foreignKey: "id_user", as: "games" });
Game.belongsTo(UserInfo, { foreignKey: "id_user", as: "user" });

SettingGame.hasMany(Game, { foreignKey: "id_setting_game", as: "games" });
Game.belongsTo(SettingGame, { foreignKey: "id_setting_game", as: "setting" });

Role.hasMany(Account, { foreignKey: "role_id", as: "accounts" });
Account.belongsTo(Role, { foreignKey: "role_id", as: "role" });

SettingTicket.hasMany(GeneratedTicket, {
	foreignKey: "id_setting_ticket",
	as: "generated_tickets",
});
GeneratedTicket.belongsTo(SettingTicket, {
	foreignKey: "id_setting_ticket",
	as: "setting_ticket",
});

UserInfo.hasMany(FilledTicket, { foreignKey: "id_user", as: "filled_tickets" });
FilledTicket.belongsTo(UserInfo, { foreignKey: "id_user", as: "user" });

GeneratedTicket.hasMany(FilledTicket, {
	foreignKey: "id_ticket",
	as: "filled_tickets",
});
FilledTicket.belongsTo(GeneratedTicket, {
	foreignKey: "id_ticket",
	as: "ticket",
});

HistoryOperation.hasMany(FilledTicket, {
	foreignKey: "id_history_operation",
	as: "filled_tickets",
});
FilledTicket.belongsTo(HistoryOperation, {
	foreignKey: "id_history_operation",
	as: "history",
});

UserInfo.hasMany(HistoryOperation, {
	foreignKey: "id_user",
	as: "history_operations",
});
HistoryOperation.belongsTo(UserInfo, { foreignKey: "id_user", as: "user" });

TypeTransaction.hasMany(HistoryOperation, {
	foreignKey: "type_transaction",
	as: "history_operations",
});
HistoryOperation.belongsTo(TypeTransaction, {
	foreignKey: "type_transaction",
	as: "transaction_type",
});

Account.hasOne(UserInfo, { foreignKey: "id_acc", as: "info" });
UserInfo.belongsTo(Account, { foreignKey: "id_acc", as: "account" });

// Добавлена связь между UserInfo и VipCost через category_vip
VipCost.hasMany(UserInfo, { foreignKey: "category_vip", as: "users" });
UserInfo.belongsTo(VipCost, { foreignKey: "category_vip", as: "vip_cost" });

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
	VipCost,
	Game,
	SettingGame,
};
