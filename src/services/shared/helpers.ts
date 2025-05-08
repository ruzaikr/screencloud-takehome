import * as productRepository from '../../repositories/productRepository';
import * as warehouseRepository from '../../repositories/warehouseRepository';
import * as inventoryRepository from '../../repositories/inventoryRepository';
import * as reservationRepository from '../../repositories/reservationRepository';
import * as orderRepository from "../../repositories/orderRepository";

export class InsufficientStockError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InsufficientStockError";
    }
}

interface AllocatedOrderLine {
    productId: string;
    warehouseId: string;
    allocatedQuantity: number;
    unitPriceCents: number;
    discountPercentage: number;
    productWeightGrams: number;
    shippingCostCentsPerKg: number;
}

/**
 * Calculates the overall total price and total discount from product details.
 *
 * @param productDetailsMap Map of product IDs to their cost and weight details.
 * @returns An object containing the overall total price and discount in cents.
 */
export function calculateOverallProductTotals(
    productDetailsMap: Map<string, productRepository.ProductCostDetails>
): { overallTotalPriceCents: number, overallTotalDiscountCents: number } {
    let overallTotalPriceCents = 0;
    let overallTotalDiscountCents = 0;
    for (const details of productDetailsMap.values()) {
        overallTotalPriceCents += details.totalProductCostCents;
        overallTotalDiscountCents += details.totalDiscountCents;
    }
    return { overallTotalPriceCents, overallTotalDiscountCents };
}

/**
 * Allocates requested products to warehouses based on available stock and sorted warehouse preference.
 *
 * @param productDetailsMap Map of product IDs to their cost and weight details.
 * @param sortedWarehouses Array of warehouses sorted by shipping preference.
 * @param currentInventoryByWarehouse Current inventory levels, locked for update.
 * @param reservedInventoryByWarehouse Current reserved inventory levels.
 * @returns An object containing allocated order lines and inventory update items.
 * @throws InsufficientStockError if any product cannot be fully allocated.
 */
export function performInventoryAllocation(
    productDetailsMap: Map<string, productRepository.ProductCostDetails>,
    sortedWarehouses: warehouseRepository.WarehouseShippingInfo[],
    currentInventoryByWarehouse: inventoryRepository.ProductInventoryByWarehouse,
    reservedInventoryByWarehouse: reservationRepository.ReservedInventoryByWarehouse
): { allocatedOrderLines: AllocatedOrderLine[], inventoryUpdates: inventoryRepository.InventoryUpdateItem[] } {
    const allocatedOrderLines: AllocatedOrderLine[] = [];
    const inventoryUpdates: inventoryRepository.InventoryUpdateItem[] = [];

    for (const [productId, productDetail] of productDetailsMap.entries()) {
        let remainingQtyToAllocate = productDetail.requestedQuantity;

        for (const warehouse of sortedWarehouses) {
            if (remainingQtyToAllocate <= 0) break;

            const warehouseId = warehouse.warehouseId;
            const stockInWarehouse = currentInventoryByWarehouse[warehouseId]?.[productId] ?? 0;
            const reservedInWarehouse = reservedInventoryByWarehouse[warehouseId]?.[productId] ?? 0;
            const availableForWalkIn = Math.max(0, stockInWarehouse - reservedInWarehouse);

            if (availableForWalkIn > 0) {
                const qtyToAllocateFromWarehouse = Math.min(remainingQtyToAllocate, availableForWalkIn);

                allocatedOrderLines.push({
                    productId: productId,
                    warehouseId: warehouseId,
                    allocatedQuantity: qtyToAllocateFromWarehouse,
                    unitPriceCents: productDetail.unitPriceCents,
                    discountPercentage: productDetail.discountPercentage,
                    productWeightGrams: productDetail.weightGrams,
                    shippingCostCentsPerKg: warehouse.shippingCostCentsPerKg,
                });

                inventoryUpdates.push({
                    productId: productId,
                    warehouseId: warehouseId,
                    quantityToDecrement: qtyToAllocateFromWarehouse,
                });
                remainingQtyToAllocate -= qtyToAllocateFromWarehouse;
            }
        }

        if (remainingQtyToAllocate > 0) {
            const allocatedForThisProduct = productDetail.requestedQuantity - remainingQtyToAllocate;
            throw new InsufficientStockError(`Insufficient stock for product ID ${productId}. Requested: ${productDetail.requestedQuantity}, Allocated from available stock: ${allocatedForThisProduct}.`);
        }
    }
    return { allocatedOrderLines, inventoryUpdates };
}

/**
 * Calculates the total shipping cost for the allocated order lines.
 *
 * @param allocatedOrderLines Array of lines with allocated quantities and shipping details.
 * @returns The total shipping cost in cents.
 */
export function calculateTotalShippingCost(allocatedOrderLines: AllocatedOrderLine[]): number {
    let totalShippingCostCents = 0;
    for (const line of allocatedOrderLines) {
        const totalWeightKgForLine = (line.allocatedQuantity * line.productWeightGrams) / 1000;
        const legShippingCost = Math.ceil(totalWeightKgForLine * line.shippingCostCentsPerKg);
        totalShippingCostCents += legShippingCost;
    }
    return totalShippingCostCents;
}

/**
 * Checks if the calculated shipping cost is within the allowed limit (15% of discounted order value).
 *
 * @param totalShippingCostCents The total calculated shipping cost.
 * @param overallTotalPriceCents The total price of products before discount.
 * @param overallTotalDiscountCents The total discount applied to products.
 * @returns True if the shipping cost is valid, false otherwise.
 */
export function isShippingCostValid(
    totalShippingCostCents: number,
    overallTotalPriceCents: number,
    overallTotalDiscountCents: number
): boolean {
    const overallDiscountedTotalPriceCents = overallTotalPriceCents - overallTotalDiscountCents;
    const maxAllowedShippingCost = Math.max(0, Math.floor(0.15 * overallDiscountedTotalPriceCents));
    return totalShippingCostCents <= maxAllowedShippingCost;
}

/**
 * Prepares the order header and order line data for database insertion.
 *
 * @param orderId The generated ID for the new order.
 * @param shippingLat Latitude of the shipping address.
 * @param shippingLng Longitude of the shipping address.
 * @param overallTotalPriceCents Total price of products before discount.
 * @param overallTotalDiscountCents Total discount applied.
 * @param totalShippingCostCents Total calculated shipping cost.
 * @param allocatedOrderLines Array of allocated order lines.
 * @returns An object containing parameters for creating order and order lines.
 */
export function prepareOrderCreationData(
    orderId: string,
    shippingLat: number,
    shippingLng: number,
    overallTotalPriceCents: number,
    overallTotalDiscountCents: number,
    totalShippingCostCents: number,
    allocatedOrderLines: AllocatedOrderLine[]
): { orderHeaderParams: orderRepository.CreateOrderParams, orderLineItemsData: orderRepository.OrderLineData[] } {
    const orderHeaderParams: orderRepository.CreateOrderParams = {
        orderId,
        shippingAddrLatitude: shippingLat,
        shippingAddrLongitude: shippingLng,
        totalPriceCents: overallTotalPriceCents,
        discountCents: overallTotalDiscountCents,
        shippingCostCents: totalShippingCostCents,
    };

    const orderLineItemsData: orderRepository.OrderLineData[] = allocatedOrderLines.map(al => ({
        productId: al.productId,
        warehouseId: al.warehouseId,
        quantity: al.allocatedQuantity,
        unitPriceCents: al.unitPriceCents,
        discountPercentage: al.discountPercentage,
    }));

    return { orderHeaderParams, orderLineItemsData };
}