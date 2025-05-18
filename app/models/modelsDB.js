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
		role_name: {
			type: DataTypes.VIRTUAL,
			get() {
				// Возвращает значение naim из связанной модели Role
				return this.role ? this.role.naim : null;
			},
		},
	},
	{
		tableName: "account",
		schema: "public",
		timestamps: false,
	}
);

// Определение связей
Role.hasMany(Account, { foreignKey: "role_id", as: "accounts" });
Account.belongsTo(Role, { foreignKey: "role_id", as: "role" });

// Синхронизация моделей с базой данных
// sequelize.sync({ alter: false });

module.exports = {
	Role,
	Account,
};
