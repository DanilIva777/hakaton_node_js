const express = require("express");
const app = express();
const port = 443; // Порт для HTTPS
const https = require("https");
const fs = require("fs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const cors = require("cors");
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
const {
	Role,
	Account,
	SettingTicket,
	GeneratedTicket,
	FilledTicket,
} = require("./app/models/modelsDB");
const privateKey = fs.readFileSync("localhost+2-key.pem");
const certificate = fs.readFileSync("localhost+2.pem");
const { Op, where } = require("sequelize");
const passport = require("passport");
const si = require("systeminformation");

app.use(passport.initialize());
app.use(
	"/.well-known/acme-challenge",
	express.static("/var/www/html/.well-known/acme-challenge")
);
app.use(express.json());
app.use(
	session({
		secret: "pAssW0rd", // Секретный ключ
		resave: false,
		saveUninitialized: true,
		cookie: {
			secure: true, // Требуется для HTTPS
			httpOnly: true, // Защита от XSS
			sameSite: "strict", // Защита от CSRF
		},
	})
);

async function generateRandomNumber(min, max) {
	try {
		// Получаем системные параметры
		const cpu = await si.cpu();
		const cpuTemp = await si.cpuTemperature();
		const fanSpeeds = await si.fan();
		const cpuLoad = await si.currentLoad();
		const time = Date.now();

		// Комбинируем параметры в одно число
		let seed = 0;
		seed += parseFloat(cpu.speed) || 0; // Скорость процессора (ГГц)
		seed += parseFloat(cpuTemp.main) || 0; // Температура процессора (°C)
		seed += fanSpeeds.length > 0 ? parseFloat(fanSpeeds[0].speed) : 0; // Скорость вентилятора (об/мин)
		seed += parseFloat(cpuLoad.currentLoad) || 0; // Загрузка процессора (%)
		seed += time; // Текущее время (миллисекунды)

		// Умножаем для усиления вариативности
		seed = Math.floor(seed * 1000);

		// Приводим к диапазону [min, max]
		const range = max - min + 1;
		const randomNumber = min + (seed % range);

		return randomNumber;
	} catch (error) {
		console.error("Ошибка при получении системных данных:", error);
		// Запасной вариант: используем Math.random в случае ошибки
		return Math.floor(min + Math.random() * (max - min + 1));
	}
}

const isAdmin = async (req, res, next) => {
	try {
		const token_body = req.headers.Authorization;
		const acc = await Account.findOne({
			where: { token: token_body },
		});
		if (acc.role_id == 1) {
			// 1 - role_id администратора
			return next();
		}
		res.sendStatus(403);
	} catch {
		res.sendStatus(403);
	}
};

const isUser = async (req, res, next) => {
	try {
		const token_body = req.headers.Authorization;
		const acc = await Account.findOne({
			where: { token: token_body },
		});
		if (acc.role_id == 2) {
			// 2 - role_id пользователя
			return next();
		}
		res.sendStatus(403);
	} catch {
		res.sendStatus(403);
	}
};

// Маршрут для регистрации
app.post("/register_user", async (req, res) => {
	const { login, password } = req.body;
	if (!login || !password) {
		return res.status(400).json({ message: "Не все поля указаны" });
	}
	const result = await registerUser({ login, password, role_id: 2 }); // 2 - role_id пользователя
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

// Маршрут для проверки авторизации
app.get(
	"/check",
	passport.authenticate("jwt", { session: false }),
	(req, res) => {
		res.json({
			isAuthenticated: true,
			user: {
				id: req.user.id,
				login: req.user.login,
				role: req.user.role,
			},
		});
	}
);

// Маршрут для выхода
app.post(
	"/logout",
	passport.authenticate("jwt", { session: false }),
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

// Создание HTTPS сервера
const credentials = { key: privateKey, cert: certificate };
app.use(
	cors({
		origin: "*", // Разрешаем запросы с любых доменов
		methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], // Разрешенные методы
		allowedHeaders: ["Content-Type", "Authorization"], // Разрешенные заголовки
		credentials: credentials,
	})
);

// Обработка сигналов завершения
process.on("SIGINT", async () => {
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
	try {
		console.log("Получен сигнал SIGTERM. Завершение работы...");
		await disconnectFromDatabase();
	} catch (error) {
		console.error("Ошибка при отключении от БД:", error);
	} finally {
		process.exit();
	}
});
