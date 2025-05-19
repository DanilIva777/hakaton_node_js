require("dotenv").config();
const { Sequelize } = require("sequelize");

const { DB_NAME, DB_USER, DB_PASSWORD, DB_HOST, DB_PORT } = process.env;

const sequelize = new Sequelize(
	String(DB_NAME),
	String(DB_USER),
	String(DB_PASSWORD),
	{
		host: String(DB_HOST),
		port: Number(DB_PORT),
		dialect: "postgres",
		define: {
			timestamps: false,
		},
	}
);

async function connectToDatabase() {
	try {
		await sequelize.authenticate();
		console.log("Connection has been established successfully.");
		return sequelize;
	} catch (error) {
		console.error("Unable to connect to the database:", error);
		throw error;
	}
}

async function disconnectFromDatabase() {
	try {
		await sequelize.close();
		console.log("Отключение от базы данных успешно");
	} catch (err) {
		console.error("Ошибка отключения от базы данных", err.stack);
	}
}

module.exports = { connectToDatabase, disconnectFromDatabase, sequelize };
