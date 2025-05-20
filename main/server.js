const express = require("express");
const app = express();
const port = 3000; // Порт для HTTPS
const http = require('http');
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
	VipCost,
	sequelize,
} = require("./app/models/modelsDB");
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
async function generateTicketNumbers(count_number_row) {
	console.log(`Generating numbers for count_number_row: ${count_number_row}`);
	const totalNumbers = Array.isArray(count_number_row)
		? count_number_row.reduce((sum, num) => sum + num, 0)
		: count_number_row;
	const numbersToSelect = totalNumbers;
	if (!numbersToSelect || numbersToSelect <= 0) {
		console.error("Invalid parameters:", {
			count_number_row,
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
			setting.count_number_row
		);
		const countFillUser = setting.count_fill_user;
		if (countFillUser > arr_number.length) {
			throw new Error(
				"count_fill_user не может быть больше количества чисел в arr_number"
			);
		}
		// Генерация выигрышных чисел
		const arr_true_number = [...arr_number]
			.sort(() => 0.5 - Math.random())
			.slice(0, countFillUser);

		const transaction = await sequelize.transaction();
		try {
			// Создание нового GeneratedTicket
			const newGeneratedTicket = await GeneratedTicket.create(
				{
					id_setting_ticket: setting.id,
					date_generated: currentDate.toISOString().split("T")[0],
					time_generated: currentDate.toTimeString().split(" ")[0],
					arr_number: arr_number,
					arr_true_number: arr_true_number,
				},
				{ transaction }
			);

			// Поиск всех FilledTicket с is_win = null для данной настройки
			const filledTickets = await FilledTicket.findAll({
				where: {
					is_win: null,
				},
				transaction,
			});

			// Проверка каждого FilledTicket
			for (const filledTicket of filledTickets) {
				const userArr = filledTicket.filled_cell.sort();
				const trueArr = arr_true_number.sort();
				const isWin =
					JSON.stringify(userArr) === JSON.stringify(trueArr);

				if (isWin) {
					// Начисление награды
					const userInfo = await UserInfo.findOne({
						where: { id: filledTicket.id_user },
						transaction,
						lock: transaction.LOCK.UPDATE,
					});
					const reward = 100; // Фиксированная награда (можно изменить)
					const newBalance =
						parseFloat(userInfo.balance_virtual) + reward;
					await userInfo.update(
						{ balance_virtual: newBalance },
						{ transaction }
					);

					// Создание записи в HistoryOperation
					let typeTransaction = await TypeTransaction.findOne({
						where: { naim: "Выигрыш в лотерее" },
						transaction,
					});
					if (!typeTransaction) {
						typeTransaction = await TypeTransaction.create(
							{
								naim: "Выигрыш в лотерее",
							},
							{ transaction }
						);
					}

					await HistoryOperation.create(
						{
							id_user: userInfo.id,
							change: reward,
							type_transaction: typeTransaction.id,
							is_succesfull: true,
							date_operation: newGeneratedTicket.date_generated,
							time_operation: newGeneratedTicket.time_generated,
						},
						{ transaction }
					);
				}

				// Обновление is_win для текущего FilledTicket
				await filledTicket.update({ is_win: isWin }, { transaction });
			}

			await transaction.commit();
			return newGeneratedTicket;
		} catch (error) {
			await transaction.rollback();
			console.error("Ошибка при создании GeneratedTicket:", error);
			throw error;
		}
	} catch (error) {
		console.error(
			`Ошибка в createGeneratedTicket для setting ID: ${setting.id}:`,
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
	try {
		if (!time) return 0;

		const parts = String(time)
			.split(":")
			.map((p) => parseInt(p, 10) || 0); // Защита от NaN

		while (parts.length < 3) parts.push(0);
		const [hours, minutes, seconds] = parts;

		if (hours > 23 || minutes > 59 || seconds > 59) {
			throw new Error("Invalid time values");
		}

		return (hours * 3600 + minutes * 60 + seconds) * 1000;
	} catch (error) {
		console.error(`Ошибка конвертации времени '${time}':`, error);
		return 0;
	}
}

// Улучшенная функция обновления кэша
async function updateSingleSetting(settingId) {
	try {
		const setting = await SettingTicket.findOne({
			where: { id: settingId },
			raw: true,
		});

		if (!setting) {
			console.log(`Настройка ${settingId} не найдена, очистка таймера`);
			if (intervalJobs[settingId]) {
				clearInterval(intervalJobs[settingId]);
				delete intervalJobs[settingId];
			}
			return;
		}

		const existingIndex = activeSettingsCache.findIndex(
			(s) => s.id === settingId
		);

		// Если настройка активна
		if (setting.is_start) {
			// Проверка изменений
			if (existingIndex >= 0) {
				const cachedSetting = activeSettingsCache[existingIndex];

				// Если изменилось время или параметры генерации
				if (
					cachedSetting.time !== setting.time ||
					JSON.stringify(cachedSetting.count_number_row) !==
						JSON.stringify(setting.count_number_row)
				) {
					console.log(
						`Обнаружены изменения в настройке ${settingId}`
					);
					activeSettingsCache[existingIndex] = setting;
					createIntervalForSetting(setting);
				}
			} else {
				// Новая активная настройка
				activeSettingsCache.push(setting);
				createIntervalForSetting(setting);
			}
		} else {
			// Удаление из кэша и остановка таймера
			if (existingIndex >= 0) {
				activeSettingsCache.splice(existingIndex, 1);
			}
			if (intervalJobs[settingId]) {
				console.log(`Остановка таймера для настройки ${settingId}`);
				clearInterval(intervalJobs[settingId]);
				delete intervalJobs[settingId];
			}
		}
	} catch (error) {
		console.error(`Ошибка обновления настройки ${settingId}:`, error);
	}
}

// Функция для создания или обновления интервала для одной настройки
function createIntervalForSetting(setting) {
	try {
		console.log(
			`[${new Date().toISOString()}] Обработка настройки ${setting.id}`
		);

		// Очистка предыдущего таймера
		if (intervalJobs[setting.id]) {
			clearInterval(intervalJobs[setting.id]);
			console.log(`Удалён предыдущий таймер для ${setting.id}`);
		}

		// Пропуск неактивных настроек
		if (!setting.is_start) {
			console.log(`Настройка ${setting.id} не активна, пропуск`);
			return;
		}

		// Валидация параметров
		if (!setting.time || !setting.count_number_row) {
			console.warn(
				`Некорректные параметры для настройки ${setting.id}`,
				setting
			);
			return;
		}

		const intervalMs = timeToMilliseconds(setting.time);
		if (intervalMs <= 0) {
			console.warn(
				`Некорректный интервал для ${setting.id}: ${setting.time}`
			);
			return;
		}

		// Создание нового интервала
		intervalJobs[setting.id] = setInterval(async () => {
			console.log(
				`[${new Date().toISOString()}] Генерация билета для ${
					setting.id
				}`
			);
			try {
				await createGeneratedTicket(setting);
			} catch (error) {
				console.error(`Ошибка генерации билета ${setting.id}:`, error);
			}
		}, intervalMs);

		console.log(
			`Установлен новый интервал для ${setting.id}: ${setting.time} (${intervalMs}ms)`
		);
	} catch (error) {
		console.error(
			`Критическая ошибка создания таймера ${setting.id}:`,
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

app.get("/vip_offers", async (req, res) => {
	try {
		const vipOffers = await VipCost.findAll({
			order: [["count_day", "ASC"]],
			attributes: ["id", "naim", "price", "count_day"],
			raw: true,
		});

		if (!vipOffers || vipOffers.length === 0) {
			return res.status(404).json({
				success: false,
				message: "VIP предложения не найдены",
			});
		}

		const formattedOffers = vipOffers.map((offer) => ({
			...offer,
			price: parseFloat(offer.price.replace(/[^0-9.]/g, "")),
		}));

		res.status(200).json({
			success: true,
			offers: formattedOffers,
		});
	} catch (error) {
		console.error("Ошибка при получении vip предложений:", error);
		res.status(500).json({
			success: false,
			message: "Ошибка сервера: " + error.message,
		});
	}
});

// Список всех текущих билетов
app.get("/current_tickets", async (req, res) => {
	try {
		// Получаем все активные настройки с is_start = true
		const activeSettings = await SettingTicket.findAll({
			where: { is_start: true },
			attributes: ["id"],
		});

		if (!activeSettings || activeSettings.length === 0) {
			return res.status(404).json({
				success: false,
				message: "No active ticket settings found",
			});
		}

		// Для каждой активной настройки находим последний сгенерированный билет
		const ticketsPromises = activeSettings.map((setting) =>
			GeneratedTicket.findOne({
				where: { id_setting_ticket: setting.id },
				attributes: [
					"id",
					"id_setting_ticket",
					"date_generated",
					"time_generated",
					"arr_number",
				],
				include: [
					{
						model: SettingTicket,
						as: "setting_ticket",
						attributes: [
							"id",
							"time",
							"price_ticket",
							"count_number_row",
							"count_fill_user",
						],
					},
				],
				order: [
					["date_generated", "DESC"],
					["time_generated", "DESC"],
				],
				limit: 1,
			})
		);

		// Ожидаем выполнения всех запросов и фильтруем результаты
		const ticketsResults = await Promise.all(ticketsPromises);
		const validTickets = ticketsResults.filter((ticket) => ticket !== null);

		if (validTickets.length === 0) {
			return res.status(404).json({
				success: false,
				message: "No generated tickets found for active settings",
			});
		}

		// Форматируем билеты для ответа
		const formattedTickets = validTickets.map((ticket) => ({
			id: ticket.id,
			setting_ticket_id: ticket.id_setting_ticket,
			date_generated: ticket.date_generated,
			time_generated: ticket.time_generated,
			numbers: ticket.arr_number,
			setting: ticket.setting_ticket
				? {
						id: ticket.setting_ticket.id,
						time: ticket.setting_ticket.time,
						price: parseFloat(
							String(ticket.setting_ticket.price_ticket).replace(
								/[^0-9.]/g,
								""
							)
						),
						count_number_row:
							ticket.setting_ticket.count_number_row,
						count_fill_user: ticket.setting_ticket.count_fill_user,
				  }
				: null,
		}));

		res.status(200).json({
			success: true,
			tickets: formattedTickets,
		});
	} catch (error) {
		console.error("Error fetching current tickets:", error);
		res.status(500).json({
			success: false,
			message: "Server error: " + error.message,
		});
	}
});

app.post("/buy_vip", isUser, async (req, res) => {
	req.setTimeout(30000);
	const transaction = await sequelize.transaction();

	try {
		const { vip_offer_id, confirm_downgrade } = req.body;
		const token = req.headers.authorization.replace("Bearer ", "");

		// Поиск аккаунта
		const account = await Account.findOne({
			where: { token },
			attributes: ["id"],
			transaction,
		});

		if (!account) {
			await transaction.rollback();
			return res.status(401).json({
				success: false,
				message: "Требуется авторизация",
			});
		}

		// Получение информации о пользователе с блокировкой
		const user = await UserInfo.findOne({
			where: { id_acc: account.id },
			attributes: [
				"id",
				"balance_virtual",
				"is_vip",
				"vip_stop_date",
				"category_vip",
			],
			transaction,
			lock: transaction.LOCK.UPDATE,
			skipLocked: true,
		});

		if (!user) {
			await transaction.rollback();
			return res.status(404).json({
				success: false,
				message: "Профиль не найден",
			});
		}

		// Валидация ID предложения
		const offerId = parseInt(vip_offer_id, 10);
		if (isNaN(offerId)) {
			await transaction.rollback();
			return res.status(400).json({
				success: false,
				message: "Неверный формат ID предложения",
			});
		}

		// Поиск VIP предложения
		const vipOffer = await VipCost.findByPk(offerId, {
			attributes: ["id", "price", "count_day", "category"],
			transaction,
			raw: true,
		});

		const TRANSACTION_TYPE_MAP = {
			1: "Покупка VIP (Мещанин)",
			2: "Покупка VIP (Буржуй)",
			3: "Покупка VIP (Олигарх)",
		};

		if (!vipOffer || !TRANSACTION_TYPE_MAP[offerId]) {
			await transaction.rollback();
			return res.status(404).json({
				success: false,
				message: "Предложение не найдено",
			});
		}

		// Проверка категории VIP
		const currentVipCategory = user.category_vip || 0;
		const newVipCategory = vipOffer.category;

		if (user.is_vip && newVipCategory < currentVipCategory) {
			if (!confirm_downgrade) {
				await transaction.rollback();
				return res.status(400).json({
					success: false,
					message:
						"Новая категория VIP ниже текущей. Подтвердите покупку.",
					requires_confirmation: true,
					current_category: currentVipCategory,
					new_category: newVipCategory,
				});
			}
		}

		// Парсинг цены
		const priceRaw = Array.isArray(vipOffer.price)
			? vipOffer.price[0]
			: vipOffer.price;
		const price = parseFloat(priceRaw.replace(/[^0-9.]/g, ""));

		if (isNaN(price) || price <= 0) {
			await transaction.rollback();
			return res.status(400).json({
				success: false,
				message: `Неверное значение цены: ${priceRaw}`,
			});
		}

		// Проверка баланса
		if (user.balance_virtual < price) {
			await transaction.rollback();
			return res.status(400).json({
				success: false,
				message: "Недостаточно средств",
			});
		}

		// Валидация длительности VIP
		const countDay = parseInt(vipOffer.count_day, 10);
		if (isNaN(countDay) || countDay <= 0) {
			await transaction.rollback();
			return res.status(400).json({
				success: false,
				message: `Неверное значение длительности: ${vipOffer.count_day}`,
			});
		}

		// Обновление данных пользователя
		const newVipStop = Sequelize.literal(
			`NOW() + INTERVAL '${countDay} DAYS'`
		);

		await UserInfo.update(
			{
				balance_virtual: Sequelize.literal(
					`CAST(balance_virtual AS NUMERIC) - CAST(${price} AS NUMERIC)`
				),
				vip_stop_date: newVipStop,
				is_vip: true,
				category_vip: vipOffer.category,
			},
			{
				where: { id: user.id },
				transaction,
			}
		);

		// Создание записи в истории операций
		const [historyRecord] = await Promise.all([
			HistoryOperation.create(
				{
					id_user: user.id,
					change: -price,
					type_transaction: Object.keys(TRANSACTION_TYPE_MAP).find(
						(key) =>
							TRANSACTION_TYPE_MAP[key] ===
							TRANSACTION_TYPE_MAP[offerId]
					),
					is_succesfull: true,
					date_operation: Sequelize.fn("NOW"),
					time_operation: Sequelize.fn("NOW"),
				},
				{ transaction }
			),
			TypeTransaction.findOrCreate({
				where: { naim: TRANSACTION_TYPE_MAP[offerId] },
				defaults: { naim: TRANSACTION_TYPE_MAP[offerId] },
				transaction,
			}),
		]);

		await transaction.commit();

		// Получение обновленных данных
		const updatedUser = await UserInfo.findOne({
			where: { id: user.id },
			attributes: ["vip_stop_date", "category_vip"],
		});

		res.json({
			success: true,
			new_balance:
				parseFloat(user.balance_virtual.replace(/[$,]/g, "")) - price,
			vip_until: updatedUser.vip_stop_date,
			vip_category: updatedUser.category_vip,
		});
	} catch (error) {
		await transaction.rollback();
		console.error(
			`[${new Date().toISOString()}] Ошибка покупки VIP:`,
			error.stack || error
		);
		res.status(500).json({
			success: false,
			message: "Внутренняя ошибка сервера",
			error:
				process.env.NODE_ENV === "development"
					? error.message
					: undefined,
		});
	}
});

// Ручка для создания записи в таблице setting_ticket (только для админа)
app.post("/setting_ticket", isAdmin, async (req, res) => {
	try {
		const {
			time,
			price_ticket,
			percent_fond,
			is_start,
			count_number_row,
			count_fill_user,
		} = req.body;

		// Валидация формата времени
		if (time && !/^\d{2}:\d{2}:\d{2}$/.test(time)) {
			return res.status(400).json({
				message: "Неверный формат времени. Используйте HH:mm:ss",
			});
		}

		// Валидация count_number_row
		if (!Array.isArray(count_number_row) || count_number_row.length === 0) {
			return res.status(400).json({
				message: "count_number_row должен быть непустым массивом",
			});
		}

		const transaction = await sequelize.transaction();

		try {
			const newSettingTicket = await SettingTicket.create(
				{
					time: time || null,
					price_ticket: price_ticket || null,
					percent_fond: percent_fond || null,
					is_start: is_start || false,
					count_number_row: count_number_row || null,
					count_fill_user: count_fill_user || null,
				},
				{ transaction }
			);

			await transaction.commit();

			// Принудительное обновление кэша и запуск таймера
			await updateSingleSetting(newSettingTicket.id);

			res.status(201).json({
				success: true,
				settingTicket: newSettingTicket.toJSON(),
			});
		} catch (error) {
			await transaction.rollback();
			throw error;
		}
	} catch (error) {
		console.error("Ошибка при создании настройки билета:", error);
		res.status(500).json({
			message: "Ошибка сервера: " + error.message,
		});
	}
});

// Ручка для изменения записи в таблице setting_ticket (только для админа)
app.put("/update-setting_ticket/:id", isAdmin, async (req, res) => {
	const transaction = await sequelize.transaction();
	try {
		const settingTicketId = parseInt(req.params.id, 10);

		// Валидация ID
		if (isNaN(settingTicketId)) {
			await transaction.rollback();
			return res.status(400).json({
				message: "Некорректный ID настройки",
			});
		}

		// Валидация формата времени
		if (req.body.time && !/^\d{2}:\d{2}:\d{2}$/.test(req.body.time)) {
			await transaction.rollback();
			return res.status(400).json({
				message: "Неверный формат времени. Используйте HH:mm:ss",
			});
		}

		// Валидация count_number_row
		if (
			req.body.count_number_row &&
			(!Array.isArray(req.body.count_number_row) ||
				req.body.count_number_row.length === 0)
		) {
			await transaction.rollback();
			return res.status(400).json({
				message: "count_number_row должен быть непустым массивом",
			});
		}

		const settingTicket = await SettingTicket.findOne({
			where: { id: settingTicketId },
			transaction,
		});

		if (!settingTicket) {
			await transaction.rollback();
			return res.status(404).json({
				message: "Настройка не найдена",
			});
		}

		// Подготовка данных для обновления
		const updateData = {
			time:
				req.body.time !== undefined
					? req.body.time
					: settingTicket.time,
			price_ticket: req.body.price_ticket ?? settingTicket.price_ticket,
			percent_fond: req.body.percent_fond ?? settingTicket.percent_fond,
			is_start: req.body.is_start ?? settingTicket.is_start,
			count_number_row:
				req.body.count_number_row ?? settingTicket.count_number_row,
			count_fill_user:
				req.body.count_fill_user ?? settingTicket.count_fill_user,
		};

		// Применение изменений
		await settingTicket.update(updateData, { transaction });
		await transaction.commit();

		// Принудительное обновление таймера
		await updateSingleSetting(settingTicketId);

		res.json({
			success: true,
			settingTicket: settingTicket.toJSON(),
		});
	} catch (error) {
		await transaction.rollback();
		console.error("Ошибка при обновлении настройки:", error);
		res.status(500).json({
			message: "Ошибка сервера: " + error.message,
		});
	}
});

app.get("/filled_ticket", isUser, async (req, res) => {
	try {
		// Получение токена из заголовка авторизации
		const token = req.headers.authorization;

		// Находим аккаунт пользователя по токену
		const account = await Account.findOne({
			where: { token },
			attributes: ["id"],
		});
		if (!account) {
			return res.status(401).json({
				success: false,
				message: "Пользователь не найден",
			});
		}

		// Находим информацию о пользователе
		const userInfo = await UserInfo.findOne({
			where: { id_acc: account.id },
			attributes: ["id"],
		});
		if (!userInfo) {
			return res.status(404).json({
				success: false,
				message: "Информация о пользователе не найдена",
			});
		}

		// Получаем все талоны пользователя, отсортированные по убыванию даты
		const filledTickets = await FilledTicket.findAll({
			where: { id_user: userInfo.id },
			attributes: [
				"id",
				"id_user",
				"id_ticket",
				"date",
				"time",
				"filled_cell",
				"is_win",
				"id_history_operation",
			],
			order: [
				["date", "DESC"],
				["time", "DESC"],
			], // Сортировка по дате и времени по убыванию
			include: [
				{
					model: GeneratedTicket,
					as: "ticket",
					attributes: [
						"id",
						"id_setting_ticket",
						"arr_number",
						"arr_true_number",
					],
					include: [
						{
							model: SettingTicket,
							as: "setting_ticket",
							attributes: [
								"id",
								"price_ticket",
								"count_number_row",
								"count_fill_user",
							],
						},
					],
				},
				{
					model: HistoryOperation,
					as: "history",
					attributes: [
						"id",
						"change",
						"type_transaction",
						"is_succesfull",
					],
					include: [
						{
							model: TypeTransaction,
							as: "transaction_type",
							attributes: ["id", "naim"],
						},
					],
				},
			],
		});

		const formattedTickets = filledTickets.map((ticket) => ({
			id: ticket.id,
			user_id: ticket.id_user,
			ticket_id: ticket.id_ticket,
			date: ticket.date,
			time: ticket.time,
			filled_cell: ticket.filled_cell,
			is_win: ticket.is_win,
			history_operation_id: ticket.id_history_operation,
			generated_ticket: ticket.ticket
				? {
						id: ticket.ticket.id,
						setting_ticket_id: ticket.ticket.id_setting_ticket,
						numbers: ticket.ticket.arr_number,
						winning_numbers: ticket.ticket.arr_true_number,
						setting: ticket.ticket.setting_ticket
							? {
									id: ticket.ticket.setting_ticket.id,
									price: parseFloat(
										String(
											ticket.ticket.setting_ticket
												.price_ticket
										).replace(/[^0-9.]/g, "")
									),
									count_number_row:
										ticket.ticket.setting_ticket
											.count_number_row,
									count_fill_user:
										ticket.ticket.setting_ticket
											.count_fill_user,
							  }
							: null,
				  }
				: null,
			history: ticket.history
				? {
						id: ticket.history.id,
						change: parseFloat(
							String(ticket.history.change).replace(
								/[^0-9.]/g,
								""
							)
						),
						type_transaction: ticket.history.transaction_type
							? ticket.history.transaction_type.naim
							: null,
						is_successful: ticket.history.is_succesfull,
				  }
				: null,
		}));

		res.status(200).json({
			success: true,
			tickets: formattedTickets,
		});
	} catch (error) {
		console.error("Ошибка при получении талонов пользователя:", error);
		res.status(500).json({
			success: false,
			message: "Ошибка сервера: " + error.message,
		});
	}
});

// Ручка для создания записи в таблице filled_ticket (только для пользователя)
app.post("/filled_ticket", isUser, async (req, res) => {
	try {
		const { id_generated_ticket, arr_number } = req.body;
		const token = req.headers.authorization;

		// Проверка входных данных
		if (
			!id_generated_ticket ||
			!Array.isArray(arr_number) ||
			arr_number.length === 0
		) {
			return res.status(400).json({
				message: "Не указаны id_generated_ticket или arr_number",
			});
		}

		// Находим пользователя
		const account = await Account.findOne({ where: { token } });
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

		// Находим generated_ticket
		const generatedTicket = await GeneratedTicket.findOne({
			where: { id: id_generated_ticket },
		});
		if (!generatedTicket) {
			return res.status(404).json({
				message: "Generated ticket не найден",
			});
		}

		// Находим настройку билета через id_setting_ticket из generated_ticket
		const settingTicket = await SettingTicket.findOne({
			where: { id: generatedTicket.id_setting_ticket, is_start: true },
		});
		if (!settingTicket) {
			return res.status(404).json({
				message: "Настройка билета не найдена или не активна",
			});
		}

		// Проверяем цену билета
		const price = parseFloat(
			String(settingTicket.price_ticket).replace(/[^0-9.]/g, "")
		);
		if (isNaN(price) || price <= 0) {
			return res
				.status(400)
				.json({ message: "Некорректная цена билета" });
		}

		// Проверяем баланс
		const currentBalance = parseFloat(
			String(userInfo.balance_real).replace(/[^0-9.]/g, "")
		);
		if (currentBalance < price) {
			return res
				.status(400)
				.json({ message: "Недостаточно средств на балансе" });
		}

		// Валидация arr_number
		const countFillUser = settingTicket.count_fill_user;
		if (arr_number.length !== countFillUser) {
			return res.status(400).json({
				message: `Ожидается ${countFillUser} чисел в arr_number`,
			});
		}
		const totalNumbers = settingTicket.count_number_row.reduce(
			(sum, num) => sum + num,
			0
		);
		const uniqueNumbers = new Set(arr_number);
		if (uniqueNumbers.size !== countFillUser) {
			return res.status(400).json({
				message: "Числа в arr_number должны быть уникальными",
			});
		}
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
			userInfo.balance_real = (currentBalance - price).toFixed(2);
			await userInfo.save({ transaction });

			// Создаём запись в HistoryOperation
			const typeTransaction = await TypeTransaction.findOne({
				where: { naim: "Ставка в лото или играх (реальная валюта)" },
				transaction,
			});
			if (!typeTransaction) {
				throw new Error(
					"Тип транзакции 'Ставка в лото или играх (реальная валюта)' не найден"
				);
			}
			const currentDate = new Date();
			const history = await HistoryOperation.create(
				{
					id_user: userInfo.id,
					change: (-price).toFixed(2),
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
					id_ticket: id_generated_ticket,
					date: currentDate.toISOString().split("T")[0],
					time: currentDate.toTimeString().split(" ")[0],
					filled_cell: arr_number,
					id_history_operation: history.id,
					is_win: null, // Начальное значение, будет обновлено при следующей генерации
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
					id_ticket: newFilledTicket.id_ticket,
					date: newFilledTicket.date,
					time: newFilledTicket.time,
					filled_cell: newFilledTicket.filled_cell,
					is_win: newFilledTicket.is_win,
				},
				newBalance: userInfo.balance_real,
			});
		} catch (error) {
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

app.get("/history_operation", isUser, async (req, res) => {
    try {
        const token = req.headers.authorization.replace("Bearer ", "");
        const { page = 1, limit = 10, type_operation } = req.query;
        
        // Валидация параметров пагинации
        const parsedPage = parseInt(page);
        const parsedLimit = parseInt(limit);
        
        if (isNaN(parsedPage)) {
            return res.status(400).json({
                success: false,
                message: "Некорректный номер страницы"
            });
        }

        if (isNaN(parsedLimit)) {
            return res.status(400).json({
                success: false,
                message: "Некорректное количество записей"
            });
        }

        // Поиск аккаунта по токену
        const account = await Account.findOne({
            where: { token },
            attributes: ["id"],
            raw: true
        });

        if (!account) {
            return res.status(401).json({
                success: false,
                message: "Требуется авторизация"
            });
        }

        // Поиск пользователя
        const user = await UserInfo.findOne({
            where: { id_acc: account.id },
            attributes: ["id"],
            raw: true
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "Профиль не найден"
            });
        }

        // Подготовка условий фильтрации
        const whereClause = { id_user: user.id };
        
        if (type_operation) {
            whereClause.type_transaction = type_operation;
        }

        // Получение истории операций с пагинацией
        const { count, rows: operations } = await HistoryOperation.findAndCountAll({
            where: whereClause,
            order: [['date_operation', 'DESC'], ['time_operation', 'DESC']],
            offset: (parsedPage - 1) * parsedLimit,
            limit: parsedLimit,
            include: [{
                model: TypeTransaction,
                attributes: ['naim'],
                required: false
            }],
            attributes: [
                'id',
                'change',
                'is_succesfull',
                'date_operation',
                'time_operation',
                'type_transaction'
            ]
        });

        // Форматирование данных для ответа
        const formattedOperations = operations.map(op => ({
            id: op.id,
            amount: op.change,
            is_successful: op.is_succesfull,
            date: op.date_operation,
            time: op.time_operation,
            operation_type: op.type_transaction,
            operation_name: op.TypeTransaction?.naim || "Неизвестная операция"
        }));

        res.json({
            success: true,
            data: formattedOperations,
            pagination: {
                current_page: parsedPage,
                total_pages: Math.ceil(count / parsedLimit),
                total_operations: count,
                per_page: parsedLimit
            }
        });

    } catch (error) {
        console.error(`[${new Date().toISOString()}] History Operation Error:`, error);
        res.status(500).json({
            success: false,
            message: "Ошибка при получении истории операций",
            error: process.env.NODE_ENV === "development" ? error.message : undefined
        });
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
