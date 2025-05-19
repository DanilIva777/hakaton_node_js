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
		const cpu = await si.cpu();
		const cpuTemp = await si.cpuTemperature();
		const cpuLoad = await si.currentLoad();
		const time = Date.now();

		let seed = 0;
		seed += parseFloat(cpu.speed) || 0;
		seed += parseFloat(cpuTemp.main) || 0;
		seed += parseFloat(cpuLoad.currentLoad) || 0;
		seed += time;

		seed = Math.floor(seed * 1000);
		const range = max - min + 1;
		const randomNumber = min + (seed % range);

		return randomNumber;
	} catch (error) {
		console.error("Ошибка при получении системных данных:", error);
		return Math.floor(min + Math.random() * (max - min + 1));
	}
}

// Функция для генерации случайных чисел для билета
async function generateTicketNumbers(size_x, size_y, count_number_row) {
	console.log(
		`Generating numbers for size_x: ${size_x}, size_y: ${size_y}, count_number_row: ${count_number_row}`
	);
	const totalNumbers = size_x * size_y;
	const numbersToSelect = Array.isArray(count_number_row)
		? count_number_row.reduce((sum, num) => sum + num, 0)
		: count_number_row;
	if (
		!size_x ||
		!size_y ||
		!numbersToSelect ||
		size_x <= 0 ||
		size_y <= 0 ||
		numbersToSelect > totalNumbers
	) {
		console.error("Invalid parameters:", {
			size_x,
			size_y,
			numbersToSelect,
		});
		throw new Error("Invalid ticket parameters");
	}
	const arr_number = [];
	for (let i = 0; i < numbersToSelect; i++) {
		const randomNum = await generateRandomNumber(1, totalNumbers);
		if (!arr_number.includes(randomNum)) {
			arr_number.push(randomNum);
		} else {
			i--;
		}
	}
	return arr_number.sort((a, b) => a - b);
}

// Функция для создания GeneratedTicket
async function createGeneratedTicket(setting) {
	try {
		const currentDate = new Date();
		const arr_number = await generateTicketNumbers(
			setting.size_x,
			setting.size_y,
			setting.count_number_row
		);
		const newGeneratedTicket = await GeneratedTicket.create({
			id_setting_ticket: setting.id,
			date_generated: currentDate.toISOString().split("T")[0],
			time_generated: currentDate.toTimeString().split(" ")[0],
			arr_number: arr_number,
			arr_true_number: [],
		});
		return newGeneratedTicket;
	} catch (error) {
		console.error(
			`Error in createGeneratedTicket for setting ID: ${setting.id}:`,
			error
		);
		throw error;
	}
}

// Кэш для активных настроек и интервалов
let activeSettingsCache = [];
let intervalJobs = {};

// Функция для преобразования времени HH:mm:ss в миллисекунды
function timeToMilliseconds(time) {
	const [hours, minutes, seconds] = time.split(":").map(Number);
	if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) {
		throw new Error(`Invalid time format: ${time}`);
	}
	return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

// Функция для создания или обновления интервала для одной настройки
function createIntervalForSetting(setting) {
	if (!setting.time) {
		console.warn(`Setting ID ${setting.id} has no time`);
		return;
	}
	try {
		const intervalMs = timeToMilliseconds(setting.time);
		if (intervalMs <= 0) {
			console.warn(
				`Invalid interval for setting ID: ${setting.id}: ${setting.time}`
			);
			return;
		}

		if (intervalJobs[setting.id]) {
			clearInterval(intervalJobs[setting.id]);
			console.log(
				`Cleared previous interval for setting ID: ${setting.id}`
			);
		}

		const interval = setInterval(async () => {
			console.log(
				`Running interval for setting ID: ${setting.id} at:`,
				new Date().toISOString()
			);
			try {
				const settingModel = SettingTicket.build(setting);
				await createGeneratedTicket(settingModel);
				console.log(
					`Completed ticket creation for setting ID: ${setting.id}`
				);
			} catch (error) {
				console.error(
					`Error in interval for setting ID: ${setting.id}:`,
					error
				);
			}
		}, intervalMs);

		intervalJobs[setting.id] = interval;
		console.log(
			`Started interval for setting ID: ${setting.id} with period ${setting.time} (${intervalMs}ms)`
		);
	} catch (error) {
		console.error(
			`Error setting interval for setting ID: ${setting.id}:`,
			error
		);
	}
}

// Функция для обновления кэша настроек при старте
async function updateSettingsCache() {
	try {
		const activeSettings = await SettingTicket.findAll({
			where: { is_start: true },
		});
		const newSettings = activeSettings.map((s) => s.toJSON());
		console.log("Fetched active settings:", newSettings);

		for (const setting of newSettings) {
			const cachedSetting = activeSettingsCache.find(
				(s) => s.id === setting.id
			);
			if (!cachedSetting || cachedSetting.time !== setting.time) {
				createIntervalForSetting(setting);
			}
		}

		const newSettingIds = newSettings.map((s) => s.id);
		for (const settingId of Object.keys(intervalJobs)) {
			if (!newSettingIds.includes(parseInt(settingId))) {
				clearInterval(intervalJobs[settingId]);
				console.log(
					`Cleared interval for removed setting ID: ${settingId}`
				);
				delete intervalJobs[settingId];
			}
		}

		activeSettingsCache = newSettings;
		console.log("Updated settings cache:", activeSettingsCache);
	} catch (error) {
		console.error("Error updating settings cache:", error);
	}
}

// Функция для обновления одной настройки
async function updateSingleSetting(settingId) {
	try {
		const setting = await SettingTicket.findOne({
			where: { id: settingId },
		});
		const settingData = setting ? setting.toJSON() : null;

		if (setting && setting.is_start) {
			const existingIndex = activeSettingsCache.findIndex(
				(s) => s.id === settingId
			);
			if (existingIndex >= 0) {
				if (
					activeSettingsCache[existingIndex].time !== settingData.time
				) {
					createIntervalForSetting(settingData);
				}
				activeSettingsCache[existingIndex] = settingData;
			} else {
				createIntervalForSetting(settingData);
				activeSettingsCache.push(settingData);
			}
		} else {
			activeSettingsCache = activeSettingsCache.filter(
				(s) => s.id !== settingId
			);
			if (intervalJobs[settingId]) {
				clearInterval(intervalJobs[settingId]);
				console.log(`Cleared interval for setting ID: ${settingId}`);
				delete intervalJobs[settingId];
			}
		}
		console.log(
			"Updated settings cache after single update:",
			activeSettingsCache
		);
	} catch (error) {
		console.error(`Error updating single setting ID ${settingId}:`, error);
	}
}

// Функция для инициализации интервалов
function scheduleGeneratedTickets() {
	console.log(
		"Starting scheduleGeneratedTickets at:",
		new Date().toISOString()
	);
	console.log(
		"Server timezone:",
		Intl.DateTimeFormat().resolvedOptions().timeZone
	);
	updateSettingsCache();
}

// Вызов функции при старте
console.log("Initializing server at:", new Date().toISOString());
scheduleGeneratedTickets();

const isAdmin = async (req, res, next) => {
	try {
		const token = req.headers.authorization;
		const acc = await Account.findOne({
			where: { token: token },
		});

		if (acc.role_id == 1) {
			return next();
		}
		res.sendStatus(403);
	} catch (err) {
		res.sendStatus(403);
	}
};

const isUser = async (req, res, next) => {
	try {
		const token = req.headers.authorization;
		const acc = await Account.findOne({
			where: { token: token },
		});
		if (acc.role_id == 2) {
			return next();
		}
		res.sendStatus(403);
	} catch (err) {
		res.sendStatus(403);
	}
};

// Маршрут для регистрации
app.post("/register_user", async (req, res) => {
	const { login, password, mail } = req.body;

	if (!login || !password) {
		return res.status(400).json({ message: "Не все поля указаны" });
	}

	const transaction = await sequelize.transaction();
	try {
		const result = await registerUser(
			{ login, password, role_id: 2, mail },
			transaction
		);
		if (!result.success) {
			await transaction.rollback();
			return res.status(400).json({ message: result.message });
		}

		// Создаём запись в UserInfo
		const newUserInfo = await UserInfo.create(
			{
				id_acc: result.user.id,
				balance_real: 0,
				balance_virtual: 0,
			},
			{ transaction }
		);

		await transaction.commit();

		res.json({
			success: true,
			user: {
				id: result.user.id,
				login: result.user.login,
				mail: result.user.mail,
				role_id: result.user.role_id,
				balance_real: newUserInfo.balance_real,
				balance_bonus: newUserInfo.balance_virtual,
			},
		});
	} catch (error) {
		await transaction.rollback();
		console.error("Ошибка при регистрации:", error);
		res.status(500).json({ message: "Ошибка сервера" });
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

// Ручка для создания записи в таблице setting_ticket (только для админа)
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

		const newSettingTicket = await SettingTicket.create({
			time: time !== undefined ? time : null,
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

		// Обновляем только новую настройку
		await updateSingleSetting(newSettingTicket.id);

		res.status(201).json({
			success: true,
			settingTicket: {
				id: newSettingTicket.id,
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
app.put("/update-setting_ticket/:id", isAdmin, async (req, res) => {
	try {
		const settingTicketId = parseInt(req.params.id, 10);
		if (isNaN(settingTicketId)) {
			return res
				.status(400)
				.json({ message: "Некорректный ID настройки билета" });
		}

		const settingTicketToUpdate = await SettingTicket.findOne({
			where: { id: settingTicketId },
		});
		if (!settingTicketToUpdate) {
			return res
				.status(404)
				.json({ message: "Настройка билета не найдена" });
		}

		const updateData = {};
		if (req.body.time !== undefined) updateData.time = req.body.time;
		if (req.body.price_ticket !== undefined)
			updateData.price_ticket = req.body.price_ticket;
		if (req.body.percent_fond !== undefined)
			updateData.percent_fond = req.body.percent_fond;
		if (req.body.is_start !== undefined)
			updateData.is_start = req.body.is_start;
		if (req.body.size_x !== undefined) updateData.size_x = req.body.size_x;
		if (req.body.size_y !== undefined) updateData.size_y = req.body.size_y;
		if (req.body.count_number_row !== undefined)
			updateData.count_number_row = req.body.count_number_row;
		if (req.body.count_fill_user !== undefined)
			updateData.count_fill_user = req.body.count_fill_user;

		await settingTicketToUpdate.update(updateData);

		// Обновляем только изменённую настройку
		await updateSingleSetting(settingTicketId);

		res.json({
			success: true,
			settingTicket: {
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

// Ручка для создания записи в таблице filled_ticket (только для пользователя)
app.post("/filled_ticket", isUser, async (req, res) => {
	try {
		const { id_setting_ticket, arr_number } = req.body;
		const token = req.headers.authorization;

		// Проверка входных данных
		if (
			!id_setting_ticket ||
			!Array.isArray(arr_number) ||
			arr_number.length === 0
		) {
			return res.status(400).json({
				message: "Не указаны id_setting_ticket или arr_number",
			});
		}

		// Находим пользователя
		const account = await Account.findOne({
			where: { token },
		});
		if (!account) {
			return res.status(401).json({ message: "Пользователь не найден" });
		}

		// Находим информацию о пользователе
		const userInfo = await UserInfo.findOne({
			where: { id_acc: account.id },
		});
		if (!userInfo) {
			return res
				.status(404)
				.json({ message: "Информация о пользователе не найдена" });
		}

		// Находим настройку билета
		const settingTicket = await SettingTicket.findOne({
			where: { id: id_setting_ticket, is_start: true },
		});
		if (!settingTicket) {
			return res.status(404).json({
				message: "Настройка билета не найдена или не активна",
			});
		}

		// Проверяем формат price_ticket и преобразуем в число
		const priceStr = settingTicket.price_ticket;
		if (priceStr == null || priceStr === "" || priceStr === "0") {
			return res
				.status(400)
				.json({ message: "Цена билета не указана или равна нулю" });
		}
		const cleanedPriceStr = String(priceStr).replace(/[^0-9.]/g, "");
		if (!cleanedPriceStr || !/^\d+\.\d{1,2}$/.test(cleanedPriceStr)) {
			return res
				.status(400)
				.json({ message: "Некорректная цена билета: неверный формат" });
		}
		const price = parseFloat(cleanedPriceStr);
		if (isNaN(price) || price <= 0) {
			return res.status(400).json({
				message:
					"Некорректная цена билета: не число или отрицательное значение",
			});
		}

		// Проверяем баланс
		const balanceStr = userInfo.balance_real;
		if (balanceStr == null || balanceStr === "") {
			return res
				.status(400)
				.json({ message: "Баланс пользователя не указан" });
		}
		const cleanedBalanceStr = String(balanceStr).replace(/[^0-9.]/g, "");
		if (!cleanedBalanceStr || !/^\d*\.?\d{1,2}$/.test(cleanedBalanceStr)) {
			return res
				.status(400)
				.json({ message: "Некорректный формат баланса пользователя" });
		}
		const currentBalance = parseFloat(cleanedBalanceStr);
		if (isNaN(currentBalance) || currentBalance < 0) {
			return res.status(400).json({
				message: "Некорректное значение баланса пользователя",
			});
		}
		if (currentBalance < price) {
			return res
				.status(400)
				.json({ message: "Недостаточно средств на балансе" });
		}

		// Проверяем arr_number
		const expectedNumbers = Array.isArray(settingTicket.count_number_row)
			? settingTicket.count_number_row.reduce((sum, num) => sum + num, 0)
			: settingTicket.count_number_row;
		if (arr_number.length !== expectedNumbers) {
			return res.status(400).json({
				message: `Ожидается ${expectedNumbers} чисел в arr_number`,
			});
		}
		const totalNumbers = settingTicket.size_x * settingTicket.size_y;
		for (const num of arr_number) {
			if (!Number.isInteger(num) || num < 1 || num > totalNumbers) {
				return res.status(400).json({
					message: `Некорректное число в arr_number: ${num}`,
				});
			}
		}

		// Начинаем транзакцию
		const transaction = await sequelize.transaction();

		try {
			// Снимаем средства с баланса
			const newBalance = currentBalance - price;
			console.log(
				`Updating balance: current=${currentBalance}, price=${price}, new=${newBalance}`
			);
			if (isNaN(newBalance) || newBalance < 0) {
				throw new Error("Рассчитанный баланс некорректен");
			}
			userInfo.balance_real = newBalance.toFixed(2); // Форматируем для MONEY
			await userInfo.save({ transaction });

			const transactionSum = -price;
			if (isNaN(transactionSum)) {
				throw new Error("Сумма транзакции некорректна");
			}

			// Создаём запись в HistoryOperation
			const typeTransaction = await TypeTransaction.findOne({
				where: { naim: "Ставка в лото или играх (реальная валюта)" },
			});
			if (!typeTransaction) {
				throw new Error("Тип транзакции 'Списание за билет' не найден");
			}
			const currentDate = new Date();

			const history = await HistoryOperation.create(
				{
					id_user: userInfo.id,
					change: transactionSum.toFixed(2), // Форматируем для MONEY
					date_operation: currentDate.toISOString().split("T")[0],
					time_operation: currentDate.toTimeString().split(" ")[0],
					type_transaction: typeTransaction.id,
				},
				{ transaction }
			);

			// Создаём запись в FilledTicket
			const newFilledTicket = await FilledTicket.create(
				{
					id_user: userInfo.id,
					id_ticket: id_setting_ticket,
					id_setting_ticket,
					date_fill: currentDate.toISOString().split("T")[0],
					time_fill: currentDate.toTimeString().split(" ")[0],
					arr_number,
					id_history_operation: history.id,
				},
				{ transaction }
			);

			// Подтверждаем транзакцию
			await transaction.commit();

			res.status(201).json({
				success: true,
				filledTicket: {
					id: newFilledTicket.id,
					id_user: newFilledTicket.id_user,
					id_setting_ticket: newFilledTicket.id_setting_ticket,
					date_fill: newFilledTicket.date_fill,
					time_fill: newFilledTicket.time_fill,
					arr_number: newFilledTicket.arr_number,
					win_sum: newFilledTicket.win_sum,
				},
				newBalance: userInfo.balance_real,
			});
		} catch (error) {
			// Откатываем транзакцию в случае ошибки
			await transaction.rollback();
			console.error("Ошибка при создании FilledTicket:", error);
			return res.status(500).json({
				message: "Ошибка при создании билета: " + error.message,
			});
		}
	} catch (error) {
		console.error("Ошибка в маршруте /filled_ticket:", error);
		res.status(500).json({ message: "Ошибка сервера: " + error.message });
	}
});

// Добавить тестовые маршруты для отладки
app.get("/debug-settings", async (req, res) => {
	try {
		console.log("Fetching active settings");
		const activeSettings = await SettingTicket.findAll({
			where: { is_start: true },
		});
		console.log(
			"Active settings:",
			activeSettings.map((s) => s.toJSON())
		);
		res.json({ success: true, settings: activeSettings });
	} catch (error) {
		console.error("Error fetching settings:", error);
		res.status(500).json({
			message: "Error fetching settings",
			error: error.message,
		});
	}
});

app.get("/debug-jobs", async (req, res) => {
	console.log("Current active intervals:", Object.keys(intervalJobs));
	res.json({
		intervals: Object.keys(intervalJobs).map((id) => ({
			settingId: id,
			time: activeSettingsCache.find((s) => s.id == id)?.time,
		})),
	});
});

app.get("/debug-generate-ticket", isAdmin, async (req, res) => {
	try {
		console.log("Debug generate ticket called");
		const setting = await SettingTicket.findOne({
			where: { is_start: true },
		});
		if (!setting) {
			console.log("No active settings found");
			return res
				.status(404)
				.json({ message: "No active settings found" });
		}
		console.log("Setting for ticket:", setting.toJSON());
		const ticket = await createGeneratedTicket(setting);
		res.json({ success: true, ticket: ticket.toJSON() });
	} catch (error) {
		console.error("Debug generate ticket error:", error);
		res.status(500).json({
			message: "Error creating ticket",
			error: error.message,
		});
	}
});

// Создание HTTPS сервера
const credentials = { key: privateKey, cert: certificate };
https.createServer(credentials, app).listen(port, () => {
	console.log(`HTTPS-сервер запущен на https://localhost:${port}`);
});

// Обработка сигналов завершения
process.on("SIGINT", async () => {
	try {
		console.log("Получен сигнал SIGINT. Завершение работы...");
		Object.keys(intervalJobs).forEach((settingId) => {
			clearInterval(intervalJobs[settingId]);
			console.log(`Cleared interval for setting ID: ${settingId}`);
		});
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
		Object.keys(intervalJobs).forEach((settingId) => {
			clearInterval(intervalJobs[settingId]);
			console.log(`Cleared interval for setting ID: ${settingId}`);
		});
		await disconnectFromDatabase();
	} catch (error) {
		console.error("Ошибка при отключении от БД:", error);
	} finally {
		process.exit();
	}
});
