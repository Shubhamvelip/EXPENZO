import logging
from repositories.supabase_client import supabase

logger = logging.getLogger("expense_repository")


class ExpenseRepository:
    """
    Data Access Layer for Expenzo Expenses.
    All reads and writes go directly to Supabase.
    """

    @classmethod
    def create_expense(cls, project_id: str, amount: float, date: str, category: str, transcript: str = None) -> dict:
        """
        Persists a new expense record to the Supabase `expenses` table.
        Returns the created expense dict (including its generated UUID).
        """
        payload = {
            "project_id": project_id,
            "amount": float(amount),
            "date": date,
            "category": category,
            "transcript": transcript or "",
        }

        response = supabase.table("expenses").insert(payload).execute()

        if not response.data:
            logger.error(f"Failed to persist expense: {response}")
            raise RuntimeError("Supabase insert returned no data for expenses table.")

        created = response.data[0]
        logger.info(f"Persisted expense to Supabase: {created}")
        return created

    @classmethod
    def get_expenses_by_project(
        cls,
        project_id: str,
        start_date: str = None,
        end_date: str = None,
    ) -> list:
        """
        Fetches expenses for a given project_id from Supabase.

        When ``start_date`` and/or ``end_date`` are supplied the query is
        bounded to that timescale window (ISO-8601 date strings, inclusive).
        Results are always ordered newest-first so the mobile layout
        receives the most recent transactions at the top.

        Args:
            project_id: UUID of the parent project.
            start_date: Lower boundary filter — ``date >= start_date``.
            end_date:   Upper boundary filter — ``date <= end_date``.

        Returns:
            List of expense record dicts, ordered by date descending.
        """
        logger.info(
            f"Fetching expenses for project_id={project_id} "
            f"start={start_date!r} end={end_date!r}"
        )
        query = (
            supabase.table("expenses")
            .select("*")
            .eq("project_id", project_id)
        )
        if start_date:
            query = query.gte("date", start_date)
        if end_date:
            query = query.lte("date", end_date)
        response = query.order("date", desc=True).execute()
        return response.data or []

    @classmethod
    def get_rolling_expenses(
        cls,
        project_id: str,
        start_date: str,
        end_date: str,
    ) -> list:
        """
        Fetches a rolling window of expenses for a project bounded by
        ``[start_date, end_date]`` (inclusive, ISO-8601 date strings).

        Applies ``.gte('date', start_date)`` and ``.lte('date', end_date)``
        filter conditions and returns results ordered by transaction date
        descending so the newest entries populate the mobile layout first.

        Args:
            project_id: UUID of the parent project.
            start_date: Rolling window lower boundary — ``date >= start_date``.
            end_date:   Rolling window upper boundary — ``date <= end_date``.

        Returns:
            List of expense record dicts within the rolling window,
            ordered by date descending.
        """
        logger.info(
            f"Fetching rolling expenses for project_id={project_id} "
            f"window=[{start_date}, {end_date}]"
        )
        response = (
            supabase.table("expenses")
            .select("*")
            .eq("project_id", project_id)
            .gte("date", start_date)
            .lte("date", end_date)
            .order("date", desc=True)
            .execute()
        )
        return response.data or []

    @classmethod
    def get_expenses_in_date_range(cls, project_id: str, start_date: str, end_date: str) -> list:
        """
        Fetches expenses for a project within a date range [start_date, end_date] inclusive.

        .. deprecated::
            Prefer :meth:`get_rolling_expenses` for new call-sites.
        """
        logger.info(f"Fetching expenses for project_id: {project_id} between {start_date} and {end_date}")
        response = (
            supabase.table("expenses")
            .select("*")
            .eq("project_id", project_id)
            .gte("date", start_date)
            .lte("date", end_date)
            .order("date", desc=True)
            .execute()
        )
        return response.data or []

    @classmethod
    def get_all_expenses(cls) -> list:
        """
        Returns all expenses in the ledger from Supabase, ordered newest-first.
        """
        response = (
            supabase.table("expenses")
            .select("*")
            .order("date", desc=True)
            .execute()
        )
        return response.data or []

    @classmethod
    def get_expenses_filtered(cls, project_id: str = None, start_date: str = None, end_date: str = None) -> list:
        """
        Returns expenses from Supabase filtered by project_id, start_date, and end_date.
        """
        logger.info(f"Filtering expenses: project={project_id}, start={start_date}, end={end_date}")
        query = supabase.table("expenses").select("*")
        if project_id:
            query = query.eq("project_id", project_id)
        if start_date:
            query = query.gte("date", start_date)
        if end_date:
            query = query.lte("date", end_date)
        response = query.order("date", desc=True).execute()
        return response.data or []

