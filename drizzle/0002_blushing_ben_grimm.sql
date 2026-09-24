CREATE TABLE `chatMemories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` varchar(128) NOT NULL,
	`content` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `chatMemories_id` PRIMARY KEY(`id`)
);
