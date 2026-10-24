import { Router, type IRouter } from "express";
import healthRouter from "./health";
import backendRouter from "./backend";
import evidenceRouter from "./evidence";
import photoCountRouter from "../features/photo-count/route";

const router: IRouter = Router();

router.use(healthRouter);
router.use(evidenceRouter);
router.use(photoCountRouter);
router.use(backendRouter);

export default router;
