const express = require("express");
const app = express();
const port = 3333;
const httpPort = 3001; // Порт для HTTP
const path = require("path");
const https = require("https");
const http = require("http");
const fs = require("fs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const {
	client,
	disconnectFromDatabase,
	connectToDatabase,
} = require("./app/models/client");
const {
	authenticateUser,
	registerUser,
	isAuthenticated,
	deleteUser,
	logoutUser,
} = require("./app/controllers/auth");
const session = require("express-session");
const { Role, Account } = require("./app/models/modelsDB");
const privateKey = fs.readFileSync("localhost+2-key.pem");
const certificate = fs.readFileSync("localhost+2.pem");
const { Op, where } = require("sequelize");
const { count } = require("console");
const passport = require("passport");
app.use(passport.initialize());
app.use(express.json());
app.use(
	session({
		secret: "pAssW0rd", // Секретный ключ
		resave: false,
		saveUninitialized: true,
		cookie: { secure: true }, //  Устанавливаем secure: true для HTTPS
	})
);

function generatePassword() {
	var length = 8,
		charset =
			"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
	res = "";
	for (var i = 0, n = charset.length; i < length; ++i) {
		res += charset.charAt(Math.floor(Math.random() * n));
	}
	return res;
}

const isAdmin = async (req, res, next) => {
	// Проверка на администратора
	try {
		token_body = req.headers.token;

		const acc = await Account.findOne({
			where: {
				token: token_body,
			},
		});

		if (acc.role_id == 1) {
			return next();
		}
	} catch {
		res.sendStatus(403);
	}
	res.sendStatus(403);
};

const isPartner = async (req, res, next) => {
	// Проверка на предприятия-партнёра
	try {
		token_body = req.headers.token;

		const acc = await Account.findOne({
			where: {
				token: token_body,
			},
		});

		if (acc.role_id == 2) {
			return next();
		}
	} catch {
		res.sendStatus(403);
	}
	res.sendStatus(403);
};

const isVolonter = async (req, res, next) => {
	// Проверка на волонтёра
	try {
		token_body = req.headers.token;

		const acc = await Account.findOne({
			where: {
				token: token_body,
			},
		});

		if (acc.role_id == 3) {
			return next();
		}
	} catch {
		res.sendStatus(403);
	}
	res.sendStatus(403);
};

// Маршрут для регистрации
app.post("/register_volonter", async (req, res) => {
	const { login, password } = req.body;

	if (!login || !password) {
		return res.status(400).json({ message: "Не все поля указаны" });
	}

	const result = await registerUser({ login, password, role_id: 3 }); // 3 - id волонтёра

	if (result.success) {
		res.json(result.user);
	} else {
		res.status(400).json({ message: result.message });
	}
});

// Маршрут для регистрации
app.post("/register_partner", async (req, res) => {
	const { login, password } = req.body;

	if (!login || !password) {
		return res.status(400).json({ message: "Не все поля указаны" });
	}

	const result = await registerUser({ login, password, role_id: 2 }); // 2 - id предприятия-партнёра

	if (result.success) {
		res.json(result.user);
	} else {
		res.status(400).json({ message: result.message });
	}
});

app.get("/auth_test", isAuthenticated, async (req, res) => {
	res.json({ text: "Пользователь авторизован" });
});

// Маршрут для логина
app.post("/login", async (req, res) => {
	const { login, password } = req.body;
	const result = await authenticateUser(login, password);

	if (result.success) {
		res.json(result.user);
	} else {
		res.status(401).json({ message: result.message });
	}
});

// Маршрут для выхода
app.post(
	"/logout",
	//passport.authenticate("jwt", { session: false }),
	logoutUser
);

// Маршрут для удаления пользователя (только для админа)
app.delete(
	"/user/:id",
	passport.authenticate("jwt", { session: false }),
	isAdmin,
	async (req, res) => {
		const userId = parseInt(req.params.id, 10);
		if (isNaN(userId)) {
			return res
				.status(400)
				.json({ message: "Некорректный ID пользователя" });
		}

		const result = await deleteUser(userId);
		if (result.success) {
			res.json({ message: result.message });
		} else {
			res.status(400).json({ message: result.message });
		}
	}
);

// Пример защищенных маршрутов для разных ролей
app.get(
	"/admin",
	passport.authenticate("jwt", { session: false }),
	isAdmin,
	(req, res) => {
		res.json({ message: "Доступ для администратора", user: req.user });
	}
);

app.get(
	"/partner",
	passport.authenticate("jwt", { session: false }),
	isPartner,
	(req, res) => {
		res.json({ message: "Доступ для партнера", user: req.user });
	}
);

app.get(
	"/volonter",
	passport.authenticate("jwt", { session: false }),
	isVolonter,
	(req, res) => {
		res.json({ message: "Доступ для волонтера", user: req.user });
	}
);

http.createServer(app).listen(port, () => {
	console.log(`HTTP-сервер запущен на http://localhost:${port}`);
});

process.on("SIGINT", async () => {
	//  Ctrl+C
	try {
		console.log("Получен сигнал SIGINT. Завершение работы...");
		await disconnectFromDatabase();
	} catch (error) {
		console.error("Ошибка при отключении от БД:", error);
	} finally {
		process.exit();
	}
});

process.on("SIGTERM", async () => {
	//  `kill` command
	try {
		console.log("Получен сигнал SIGTERM. Завершение работы...");
		await disconnectFromDatabase();
	} catch (error) {
		console.error("Ошибка при отключении от БД:", error);
	} finally {
		process.exit();
	}
});
