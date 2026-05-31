import math
import datetime
import logging
from repositories.expense_repository import ExpenseRepository

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("analytics_service")

# Reference Today Date: Sunday, May 31, 2026
TODAY_DATE = datetime.date(2026, 5, 31)

def compute_burn_rate(project_id: str, total_budget: float, timescale: str = "month") -> dict:
    """
    Computes the project's remaining budget, daily average expenditure in the timescale,
    projected budget exhaustion date, and budget health status badge.
    
    Args:
        project_id: The ID of the project.
        total_budget: The total budget envelope (B0) for the project.
        timescale: The timescale for computing the daily average ('daily', 'weekly', 'month', 'yearly').
        
    Returns:
        dict: A dictionary containing:
            - 'remaining_budget': Remaining budget (Br)
            - 'daily_average': Daily average expenditure in the timescale (De)
            - 'exhaustion_date': Projected date of exhaustion as YYYY-MM-DD string, or None
            - 'status': Health status badge ('CRITICAL', 'WARNING', or 'SAFE')
    """
    logger.info(f"Computing burn rate for project_id: '{project_id}' with total budget: {total_budget}, timescale: {timescale}")
    
    # 1. Fetch all expenses for the project to calculate remaining balance: Br = B0 - ΣA
    all_expenses = ExpenseRepository.get_expenses_by_project(project_id)
    total_expenditure = sum(float(exp.get("amount", 0)) for exp in all_expenses)
    remaining_budget = total_budget - total_expenditure
    
    logger.info(f"Total expenditure: {total_expenditure:.2f}, Remaining budget: {remaining_budget:.2f}")

    # 2. Resolve date range and days in timescale relative to Sunday, May 31, 2026
    timescale = (timescale or "month").lower().strip()
    if timescale == "daily":
        start_date = TODAY_DATE.strftime("%Y-%m-%d")
        end_date = TODAY_DATE.strftime("%Y-%m-%d")
        num_days = 1.0
    elif timescale == "weekly":
        start_date = (TODAY_DATE - datetime.timedelta(days=6)).strftime("%Y-%m-%d")
        end_date = TODAY_DATE.strftime("%Y-%m-%d")
        num_days = 7.0
    elif timescale == "month":
        start_date = "2026-05-01"
        end_date = "2026-05-31"
        num_days = 31.0
    elif timescale == "yearly":
        start_date = "2026-01-01"
        end_date = "2026-12-31"
        num_days = 365.0
    else:
        # Fallback to month
        start_date = "2026-05-01"
        end_date = "2026-05-31"
        num_days = 31.0

    rolling_expenses = ExpenseRepository.get_expenses_in_date_range(project_id, start_date, end_date)
    total_rolling_expenditure = sum(float(exp.get("amount", 0)) for exp in rolling_expenses)
    daily_average = total_rolling_expenditure / num_days
    
    logger.info(f"Timescale expenditure ({timescale}): {total_rolling_expenditure:.2f}, Daily average: {daily_average:.4f}")

    # 3. Critical Guard: If De == 0 or remaining budget is negative/zero, return safe payload structure
    if daily_average == 0.0 or remaining_budget <= 0:
        logger.info(f"Daily average is 0 or budget exhausted (remaining: {remaining_budget}). Returning CRITICAL/safe payload.")
        status = "CRITICAL" if remaining_budget <= 0 else "SAFE"
        return {
            "remaining_budget": max(0, remaining_budget),
            "daily_average": daily_average,
            "exhaustion_date": None if remaining_budget > 0 else TODAY_DATE.strftime("%Y-%m-%d"),
            "status": status
        }

    # 4. Calculate projected budget exhaustion days: days_left = math.ceil(Br / De)
    days_left = math.ceil(remaining_budget / daily_average)
    
    # 5. Compute the final YYYY-MM-DD exhaustion date string
    exhaustion_date_obj = TODAY_DATE + datetime.timedelta(days=days_left)
    exhaustion_date_str = exhaustion_date_obj.strftime("%Y-%m-%d")
    
    # 6. Determine budget health status
    if days_left <= 3:
        status = "CRITICAL"
    elif days_left <= 30:
        status = "WARNING"
    else:
        status = "SAFE"
        
    result_payload = {
        "remaining_budget": remaining_budget,
        "daily_average": daily_average,
        "exhaustion_date": exhaustion_date_str,
        "status": status
    }
    
    logger.info(f"Burn rate calculation complete: {result_payload}")
    return result_payload

