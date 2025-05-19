const express = require("express");
const app = express();
const port = 3000; // Порт для HTTPS
const http = require('http');
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
} = require("./app/controllers/auth");
const session = require("express-session");
const {
	Role,
	Account,
	SettingTicket,
	GeneratedTicket,
	FilledTicket,
	HistoryOperation,
	TypeTransaction,
	UserInfo,
	sequelize,
} = require("./app/models/modelsDB");
const privateKey = fs.readFileSync("localhost+2-key.pem");
const certificate = fs.readFileSync("localhost+2.pem");
const { Op, where } = require("sequelize");
const passport = require("passport");
const si = require("systeminformation");
const { console } = require("inspector");

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

// Настройка CORS
app.use(
	cors({
		origin: "*", // Разрешаем запросы с любых доменов
		methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], // Разрешенные методы
		allowedHeaders: ["Content-Type", "Authorization"], // Разрешенные заголовки
		credentials: true, // Разрешаем отправку куки и заголовков авторизации
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
		const token_body = req.headers.authorization;
		const acc = await Account.findOne({
			where: { token: token_body },
		});

		if (acc.role_id == 1) {
			// 1 - role_id администратора
			return next();
		}
		res.sendStatus(403);
	} catch (err) {
		res.sendStatus(403);
	}
};

const isUser = async (req, res, next) => {
	try {
		const token_body = req.headers.authorization;
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
	const { login, password, mail } = req.body;

	if (!login || !password) {
		return res.status(400).json({ message: "Не все поля указаны" });
	}

	const result = await registerUser({ login, password, role_id: 2, mail });
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
	const { identifier, password } = req.body;
	if (!identifier || !password) {
		return res.status(400).json({ message: "Не все поля указаны" });
	}
	try {
		const result = await authenticateUser({ identifier, password });
		if (result.success) {
			res.json(result.user);
		} else {
			res.status(401).json({ message: result.message });
		}
	} catch (error) {
		console.error("Ошибка при логине:", error);
		res.status(500).json({ message: "Ошибка подключения к базе данных" });
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

// Ручка для обновления почты
app.put(
	"/update-mail",
	passport.authenticate("jwt", { session: false }),
	async (req, res) => {
		const { newMail } = req.body;
		if (!newMail) {
			return res.status(400).json({ message: "Новая почта не указана" });
		}

		const result = await updateUserMail(req.user.id, newMail);
		if (result.success) {
			res.json({ message: result.message });
		} else {
			res.status(400).json({ message: result.message });
		}
	}
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

// Предполагается, что модели (SettingTicket, Account, Role и т.д.)
// импортированы из файла с моделями, например:
// const { SettingTicket, Account, Role } = require('./models');

// Также предполагается, что passport и isAdmin middleware определены

// Ручка для создания записи в таблице setting_ticket (только для админа)
// Путь сохранен как "/generate-ticket", но создает настройку билета
app.post("/setting_ticket", isAdmin, async (req, res) => {
	try {
		const {
			time,
			price_ticket,
			percent_fond,
			is_start,
			size_x,
			size_y,
			count_number_row,
			count_fill_user,
		} = req.body;

		// Создание новой записи в таблице setting_ticket
		const newSettingTicket = await SettingTicket.create({
			time: time !== undefined ? time : null, // Проверяем, были ли поля в body
			price_ticket: price_ticket !== undefined ? price_ticket : null,
			percent_fond: percent_fond !== undefined ? percent_fond : null,
			is_start: is_start !== undefined ? is_start : null,
			size_x: size_x !== undefined ? size_x : null,
			size_y: size_y !== undefined ? size_y : null,
			count_number_row:
				count_number_row !== undefined ? count_number_row : null,
			count_fill_user:
				count_fill_user !== undefined ? count_fill_user : null,
		});

		res.status(201).json({
			success: true,
			settingTicket: {
				// Объект в ответе теперь представляет запись setting_ticket
				id: newSettingTicket.id, // ID новой записи в setting_ticket
				time: newSettingTicket.time,
				price_ticket: newSettingTicket.price_ticket,
				percent_fond: newSettingTicket.percent_fond,
				is_start: newSettingTicket.is_start,
				size_x: newSettingTicket.size_x,
				size_y: newSettingTicket.size_y,
				count_number_row: newSettingTicket.count_number_row,
				count_fill_user: newSettingTicket.count_fill_user,
			},
		});
	} catch (error) {
		console.error("Ошибка при создании настройки билета:", error);
		res.status(500).json({ message: "Ошибка сервера" });
	}
});

// Ручка для изменения записи в таблице setting_ticket (только для админа)
// Путь сохранен как "/update-ticket/:id", но обновляет настройку билета
app.put("/update-setting_ticket/:id", isAdmin, async (req, res) => {
	try {
		// ID в пути теперь относится к ID записи в таблице setting_ticket
		const settingTicketId = parseInt(req.params.id, 10);
		if (isNaN(settingTicketId)) {
			return res
				.status(400)
				.json({ message: "Некорректный ID настройки билета" });
		}

		// Поля для обновления должны соответствовать полям таблицы setting_ticket
		const {
			time,
			price_ticket,
			percent_fond,
			is_start,
			size_x,
			size_y,
			count_number_row,
			count_fill_user,
		} = req.body;

		// Поиск записи в таблице setting_ticket по ее ID
		const settingTicketToUpdate = await SettingTicket.findOne({
			where: { id: settingTicketId },
		});
		if (!settingTicketToUpdate) {
			return res
				.status(404)
				.json({ message: "Настройка билета не найдена" });
		}

		// Объект с данными для обновления. Включаем только те поля, которые были переданы в body.
		const updateData = {};
		if (time !== undefined) updateData.time = time;
		if (price_ticket !== undefined) updateData.price_ticket = price_ticket;
		if (percent_fond !== undefined) updateData.percent_fond = percent_fond;
		if (is_start !== undefined) updateData.is_start = is_start;
		if (size_x !== undefined) updateData.size_x = size_x;
		if (size_y !== undefined) updateData.size_y = size_y;
		if (count_number_row !== undefined)
			updateData.count_number_row = count_number_row;
		if (count_fill_user !== undefined)
			updateData.count_fill_user = count_fill_user;

		// Обновление записи setting_ticket
		await settingTicketToUpdate.update(updateData);

		res.json({
			success: true,
			settingTicket: {
				// Объект в ответе представляет обновленную запись setting_ticket
				id: settingTicketToUpdate.id,
				time: settingTicketToUpdate.time,
				price_ticket: settingTicketToUpdate.price_ticket,
				percent_fond: settingTicketToUpdate.percent_fond,
				is_start: settingTicketToUpdate.is_start,
				size_x: settingTicketToUpdate.size_x,
				size_y: settingTicketToUpdate.size_y,
				count_number_row: settingTicketToUpdate.count_number_row,
				count_fill_user: settingTicketToUpdate.count_fill_user,
			},
		});
	} catch (error) {
		console.error("Ошибка при обновлении настройки билета:", error);
		res.status(500).json({ message: "Ошибка сервера" });
	}
});

http.createServer(app).listen(port, () => {
    console.log(`HTTP-сервер запущен на http://localhost:${port}`);
});

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
